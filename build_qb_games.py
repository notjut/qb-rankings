"""
build_qb_games.py
Builds the data behind the QB Game Rankings site from nflverse (free, community maintained).

What it writes:
  data/qb_games.json   every qualifying QB game line since 1999, with the final score, home or road,
                       weather and whether he led a game-winning drive
  data/qbr.json        ESPN week-level QBR (2006 on)
  data/players.json    player id -> headshot photo URL
  data/teams.json      team abbreviation -> name and colors

FULL-GAME RULE
A game only counts if the quarterback played the whole game. Using play-by-play, a QB
qualifies when (a) he took at least 90% of his team's quarterback snaps that we can see
(dropbacks, kneel-downs, spikes) and (b) he appears in every one of the four quarters in
which his team's quarterbacks had a play. Starters who left hurt or were rested, and the
backups who replaced them, are dropped.

BENCHED STARTERS STILL COUNT
A starter who was pulled for poor play is kept: he took his team's first snap, left in the
second half while trailing by 14 or more, never came back, and no play notes him as injured.

Run by the GitHub Actions workflow every week:
    pip install nflreadpy polars requests
    python build_qb_games.py
"""

import datetime as dt
import io
import json
import os
import sys

import polars as pl
import requests

try:
    import nflreadpy as nfl
except ImportError:
    sys.exit("nflreadpy is not installed. Run: pip install nflreadpy polars requests")

try:  # keep memory low: do not hold every season of play-by-play in the cache
    from nflreadpy.config import update_config
    update_config(cache_mode="off")
except Exception:
    pass

DATA_DIR = "data"
QBR_URL = "https://github.com/nflverse/nflverse-data/releases/download/espn_data/qbr_week_level.csv"
MIN_SNAP_SHARE = 0.90
BENCH_MARGIN = 14
TEAM_FIX = {"OAK": "LV", "SD": "LAC", "STL": "LA"}

GAME_COLS = [
    "player_id", "player_display_name", "player_name", "team", "opponent_team", "season", "week",
    "season_type", "position", "completions", "attempts", "passing_yards", "passing_tds",
    "passing_interceptions", "sacks_suffered", "sack_yards_lost",
    "sack_fumbles_lost", "rushing_fumbles_lost", "receiving_fumbles_lost", "carries", "rushing_yards", "rushing_tds",
    "gameday", "home", "neutral", "team_score", "opp_score", "snap_share",
    "roof", "temp", "wind", "precip", "gwd", "benched", "exit_qtr", "exit_margin",
]
QBR_COLS = [
    "season", "season_type", "game_week", "team_abb", "name_short", "name_display", "name_first", "name_last",
    "qbr_total", "qbr_raw",
]


def to_polars(df):
    return df if isinstance(df, pl.DataFrame) else pl.from_pandas(df)


def load_all_player_weeks():
    try:
        return to_polars(nfl.load_player_stats(seasons=True, summary_level="week"))
    except TypeError:
        return to_polars(nfl.load_player_stats(seasons=True))


def write_json(df, wanted_cols, path, extra):
    cols = [c for c in wanted_cols if c in df.columns]
    sub = df.select(cols)
    float_cols = [c for c in sub.columns if sub[c].dtype in (pl.Float32, pl.Float64)]
    if float_cols:
        sub = sub.with_columns([pl.col(c).fill_nan(None) for c in float_cols])
    payload = dict(extra)
    payload["headers"] = cols
    payload["rows"] = [list(r) for r in sub.iter_rows()]
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, separators=(",", ":"), allow_nan=False, default=str)
    return len(payload["rows"])


def qb_snaps_for_season(season, qb_ids):
    """Per (season, week, player_id): snap share among his team's QBs, quarters he appeared in, and whether he was benched."""
    pbp = to_polars(nfl.load_pbp(seasons=[season]))
    need = ["game_id", "season", "week", "posteam", "qtr", "passer_player_id", "rusher_player_id", "passer_player_name",
            "rusher_player_name", "qb_dropback", "qb_kneel", "qb_spike", "posteam_score", "defteam_score", "desc"]
    missing = [c for c in need if c not in pbp.columns]
    if missing:
        sys.exit(f"Play-by-play for {season} is missing columns: {missing}")
    p = pbp.select(need).with_row_index("n").filter(pl.col("posteam").is_not_null() & (pl.col("qtr") <= 4))
    snap = ((pl.col("qb_dropback") == 1) | (pl.col("qb_kneel") == 1) | (pl.col("qb_spike") == 1)).fill_null(False).alias("snap")
    margin = (pl.col("posteam_score") - pl.col("defteam_score")).alias("margin")
    base = ["n", "game_id", "season", "week", "posteam", "qtr"]
    # every play a quarterback is credited on, as passer or runner
    a = p.select(*base, pl.col("passer_player_id").alias("pid"), pl.col("passer_player_name").alias("name"), snap, margin)
    b = p.filter(pl.col("passer_player_id").is_null()).select(
        *base, pl.col("rusher_player_id").alias("pid"), pl.col("rusher_player_name").alias("name"), snap, margin)
    plays = pl.concat([a, b]).filter(pl.col("pid").is_not_null() & pl.col("pid").is_in(list(qb_ids))).sort("n")

    keys = ["season", "week", "posteam"]
    team_q = plays.group_by(keys).agg(pl.col("snap").sum().alias("team_snaps"), pl.col("qtr").n_unique().alias("team_qtrs"))
    mine = plays.group_by(keys + ["pid"]).agg(
        pl.col("snap").sum().alias("my_snaps"), pl.col("qtr").n_unique().alias("my_qtrs"), pl.col("game_id").first())
    snaps_only = plays.filter(pl.col("snap"))
    order = snaps_only.group_by(keys, maintain_order=True).agg(pl.col("pid").first().alias("starter"), pl.col("pid").last().alias("closer"))
    exits = snaps_only.group_by(keys + ["pid"], maintain_order=True).agg(
        pl.col("qtr").last().alias("exit_qtr"), pl.col("margin").last().alias("exit_margin"), pl.col("name").drop_nulls().last().alias("name"))
    hurt = pbp.select("game_id", "desc").filter(pl.col("desc").is_not_null() & pl.col("desc").str.contains("was injured")).group_by("game_id").agg(
        pl.col("desc").str.join(" | ").alias("injury_notes"))

    out = (mine.join(team_q, on=keys, how="left").join(order, on=keys, how="left")
           .join(exits, on=keys + ["pid"], how="left").join(hurt, on="game_id", how="left"))
    injured = pl.col("injury_notes").fill_null("").str.contains(
        pl.concat_str([pl.lit("-"), pl.col("name").fill_null("?"), pl.lit(" was injured")]), literal=True)
    out = out.with_columns(
        (pl.col("my_snaps") / pl.when(pl.col("team_snaps") > 0).then(pl.col("team_snaps")).otherwise(None)).alias("snap_share"),
        (pl.col("my_qtrs") == pl.col("team_qtrs")).alias("all_qtrs"),
        # benched for poor play: the starter, pulled in the second half while trailing by two scores or more, never returned, no injury noted
        ((pl.col("pid") == pl.col("starter")) & (pl.col("pid") != pl.col("closer")) & (pl.col("exit_qtr") >= 3)
         & (pl.col("exit_margin") <= -BENCH_MARGIN) & ~injured).fill_null(False).alias("benched"),
    )
    snaps = out.select(
        pl.col("season").cast(pl.Int64), pl.col("week").cast(pl.Int64), pl.col("pid").alias("player_id"),
        "snap_share", "all_qtrs", "benched", pl.col("exit_qtr").cast(pl.Int64), pl.col("exit_margin").cast(pl.Int64))
    return snaps, game_winning_drives(pbp), precipitation(pbp)


KEY_SCHEMA = {"season": pl.Int64, "week": pl.Int64, "team": pl.Utf8}


def game_winning_drives(pbp):
    """Teams whose offense took the lead for good in the 4th quarter or overtime (the usual game-winning-drive definition)."""
    cols = ["game_id", "season", "week", "posteam", "qtr", "home_team", "away_team", "result",
            "posteam_score", "defteam_score", "posteam_score_post", "defteam_score_post", "play_type"]
    empty = pl.DataFrame(schema={**KEY_SCHEMA, "gwd": pl.Int64})
    if any(c not in pbp.columns for c in cols):
        return empty
    lead = pbp.select(cols).with_row_index("n").filter(
        pl.col("posteam").is_not_null()
        & pl.col("play_type").is_in(["pass", "run", "field_goal", "extra_point"])
        & (pl.col("posteam_score") <= pl.col("defteam_score"))
        & (pl.col("posteam_score_post") > pl.col("defteam_score_post")))
    if lead.height == 0:
        return empty
    last = lead.sort("n").group_by("game_id", maintain_order=True).agg(pl.all().last())
    last = last.with_columns(
        pl.when(pl.col("result") > 0).then(pl.col("home_team")).when(pl.col("result") < 0).then(pl.col("away_team")).otherwise(None).alias("winner"))
    won = last.filter((pl.col("posteam") == pl.col("winner")) & (pl.col("qtr") >= 4))
    return won.select(pl.col("season").cast(pl.Int64), pl.col("week").cast(pl.Int64), pl.col("posteam").alias("team"), pl.lit(1).cast(pl.Int64).alias("gwd"))


def precipitation(pbp):
    """Rain or snow, read from the game weather note. One row per team per game."""
    empty = pl.DataFrame(schema={**KEY_SCHEMA, "precip": pl.Utf8})
    cols = ["game_id", "season", "week", "home_team", "away_team", "weather"]
    if any(c not in pbp.columns for c in cols):
        return empty
    g = pbp.select(cols).filter(pl.col("weather").is_not_null()).group_by("game_id", maintain_order=True).agg(pl.all().first())
    wx = pl.col("weather").str.to_lowercase()
    sure = ~wx.str.contains("chance")
    g = g.with_columns(
        pl.when(wx.str.contains("snow|flurr") & sure).then(pl.lit("snow"))
        .when(wx.str.contains("rain|shower|drizzle") & sure).then(pl.lit("rain")).otherwise(None).alias("precip")
    ).filter(pl.col("precip").is_not_null())
    if g.height == 0:
        return empty
    rows = [g.select(pl.col("season").cast(pl.Int64), pl.col("week").cast(pl.Int64), pl.col(side).alias("team"), "precip") for side in ("home_team", "away_team")]
    return pl.concat(rows)


def schedule_lines():
    """Two rows per game (one per team): date, home/away, score for and against."""
    s = to_polars(nfl.load_schedules(seasons=True))
    s = s.filter(pl.col("home_score").is_not_null())
    fix = lambda c: pl.col(c).replace(TEAM_FIX)
    opt = lambda c, t: (pl.col(c).cast(t, strict=False) if c in s.columns else pl.lit(None, dtype=t)).alias(c)
    neutral = ((pl.col("location") == "Neutral") if "location" in s.columns else pl.lit(False)).cast(pl.Int64).alias("neutral")
    extra = [opt("roof", pl.Utf8), opt("temp", pl.Float64), opt("wind", pl.Float64), neutral]
    home = s.select(pl.col("season").cast(pl.Int64), pl.col("week").cast(pl.Int64), fix("home_team").alias("team"),
                    pl.col("gameday").cast(pl.Utf8), pl.lit(1).alias("home"),
                    pl.col("home_score").cast(pl.Int64).alias("team_score"), pl.col("away_score").cast(pl.Int64).alias("opp_score"), *extra)
    away = s.select(pl.col("season").cast(pl.Int64), pl.col("week").cast(pl.Int64), fix("away_team").alias("team"),
                    pl.col("gameday").cast(pl.Utf8), pl.lit(0).alias("home"),
                    pl.col("away_score").cast(pl.Int64).alias("team_score"), pl.col("home_score").cast(pl.Int64).alias("opp_score"), *extra)
    return pl.concat([home, away]).unique(subset=["season", "week", "team"])


def main():
    os.makedirs(DATA_DIR, exist_ok=True)
    today = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d")

    print("Downloading player game stats for every season since 1999...")
    stats = load_all_player_weeks()
    for c in ("attempts", "player_id", "season", "week"):
        if c not in stats.columns:
            sys.exit(f"Unexpected columns from nflreadpy; expected '{c}'. Columns: " + ", ".join(stats.columns))
    if "team" not in stats.columns and "recent_team" in stats.columns:
        stats = stats.rename({"recent_team": "team"})
    if "passing_interceptions" not in stats.columns and "interceptions" in stats.columns:
        stats = stats.rename({"interceptions": "passing_interceptions"})
    if "sacks_suffered" not in stats.columns and "sacks" in stats.columns:
        stats = stats.rename({"sacks": "sacks_suffered"})
    if "sack_yards_lost" not in stats.columns and "sack_yards" in stats.columns:
        stats = stats.rename({"sack_yards": "sack_yards_lost"})

    passers = stats.filter(pl.col("attempts") > 0)
    if "position" in passers.columns:
        passers = passers.filter((pl.col("position") == "QB") | pl.col("position").is_null())
    passers = passers.with_columns(pl.col("season").cast(pl.Int64), pl.col("week").cast(pl.Int64))
    qb_ids = set(passers["player_id"].drop_nulls().unique().to_list())
    seasons = sorted(passers["season"].unique().to_list())
    print(f"{passers.height:,} QB game lines before the full-game check, seasons {seasons[0]}-{seasons[-1]}")

    print("Reading play-by-play to find who played the whole game...")
    parts, gwds, wets = [], [], []
    for season in seasons:
        part, gwd, wet = qb_snaps_for_season(season, qb_ids)
        parts.append(part)
        gwds.append(gwd)
        wets.append(wet)
        print(f"  {season}: {part.height} QB appearances, {gwd.height} game-winning drives, {wet.height // 2} rain or snow games")
    snaps = pl.concat(parts).unique(subset=["season", "week", "player_id"])
    gwd_all = pl.concat(gwds).unique(subset=["season", "week", "team"])
    wet_all = pl.concat(wets).unique(subset=["season", "week", "team"])

    passers = passers.join(snaps, on=["season", "week", "player_id"], how="left")
    unverified = passers.filter(pl.col("snap_share").is_null()).height
    whole = (pl.col("snap_share") >= MIN_SNAP_SHARE) & pl.col("all_qtrs")
    full = passers.filter(whole | pl.col("benched").fill_null(False))
    full = full.with_columns(
        (pl.col("benched").fill_null(False) & ~whole.fill_null(False)).cast(pl.Int64).alias("benched"),
    ).with_columns(
        pl.when(pl.col("benched") == 1).then(pl.col("exit_qtr")).otherwise(None).alias("exit_qtr"),
        pl.when(pl.col("benched") == 1).then(pl.col("exit_margin")).otherwise(None).alias("exit_margin"))
    print(f"  of those, {int(full['benched'].sum()):,} are starters who were benched while trailing by {BENCH_MARGIN}+ in the second half")
    dropped = passers.height - full.height
    print(f"Full games: {full.height:,}. Dropped {dropped:,} partial games ({unverified:,} of those had no play-by-play match).")
    if full.height < passers.height * 0.5:
        sys.exit("The full-game check removed more than half of all games, which means something is wrong. Stopping without publishing.")

    print("Adding dates and final scores from the schedule...")
    try:
        sched = schedule_lines()
        full = full.join(sched, on=["season", "week", "team"], how="left")
        print(f"  matched {full.filter(pl.col('team_score').is_not_null()).height:,} of {full.height:,}")
    except Exception as e:  # scores are a nice-to-have; never block the refresh on them
        print(f"  could not add scores: {e}")

    full = full.join(gwd_all, on=["season", "week", "team"], how="left").join(wet_all, on=["season", "week", "team"], how="left")
    full = full.with_columns(pl.col("gwd").fill_null(0))
    n_gwd = int(full["gwd"].sum())
    n_wet = full.filter(pl.col("precip").is_not_null()).height
    print(f"  game-winning drives credited: {n_gwd:,}; rain or snow games: {n_wet:,}")
    full = full.with_columns(pl.col("snap_share").round(3)).sort(["season", "week"])
    n = write_json(full, GAME_COLS, os.path.join(DATA_DIR, "qb_games.json"),
                   {"built": today, "source": "nflverse stats_player + pbp", "rule": "full games only", "dropped_partial": dropped})
    print(f"Wrote data/qb_games.json: {n:,} full QB games")

    print("Player photos...")
    heads = {}
    if "headshot_url" in stats.columns:
        hs = stats.filter(pl.col("headshot_url").is_not_null() & pl.col("player_id").is_in(list(qb_ids))).sort(["season", "week"])
        for pid, url in hs.select("player_id", "headshot_url").iter_rows():
            heads[pid] = url
    try:
        pls = to_polars(nfl.load_players())
        idc = "gsis_id" if "gsis_id" in pls.columns else None
        hc = "headshot" if "headshot" in pls.columns else ("headshot_url" if "headshot_url" in pls.columns else None)
        if idc and hc:
            for pid, url in pls.filter(pl.col(hc).is_not_null() & pl.col(idc).is_in(list(qb_ids))).select(idc, hc).iter_rows():
                heads.setdefault(pid, url)
    except Exception as e:
        print(f"  players table not available: {e}")
    used = set(full["player_id"].drop_nulls().unique().to_list())
    heads = {k: v for k, v in heads.items() if k in used and isinstance(v, str) and v.startswith("http")}
    with open(os.path.join(DATA_DIR, "players.json"), "w", encoding="utf-8") as f:
        json.dump({"built": today, "headshots": heads}, f, separators=(",", ":"))
    print(f"Wrote data/players.json: {len(heads):,} photos for {len(used):,} quarterbacks")

    print("Team colors...")
    try:
        tm = to_polars(nfl.load_teams())
        teams = {}
        for row in tm.iter_rows(named=True):
            ab = row.get("team_abbr")
            if not ab:
                continue
            teams[ab] = {"name": row.get("team_name"), "nick": row.get("team_nick"),
                         "color": row.get("team_color"), "color2": row.get("team_color2")}
        with open(os.path.join(DATA_DIR, "teams.json"), "w", encoding="utf-8") as f:
            json.dump({"built": today, "teams": teams}, f, separators=(",", ":"))
        print(f"Wrote data/teams.json: {len(teams)} teams")
    except Exception as e:
        print(f"  could not load teams (the site falls back to built-in colors): {e}")

    print("Downloading ESPN week-level QBR...")
    resp = requests.get(QBR_URL, timeout=180)
    if resp.status_code != 200:
        print(f"Could not fetch QBR (HTTP {resp.status_code}). QBR keeps its previous file if one exists.")
        return
    qbr = pl.read_csv(io.BytesIO(resp.content), infer_schema_length=10000)
    m = write_json(qbr, QBR_COLS, os.path.join(DATA_DIR, "qbr.json"), {"built": today, "source": "ESPN via nflverse espn_data"})
    print(f"Wrote data/qbr.json: {m:,} QBR rows")
    print("Done.")


if __name__ == "__main__":
    main()
