"""
build_qb_games.py
Builds the data behind the QB Game Rankings site from nflverse (free, community maintained).

What it writes:
  data/qb_games.json   every qualifying QB game line since 1999
  data/qbr.json        ESPN week-level QBR (2006 on)
  data/players.json    player id -> headshot photo URL
  data/teams.json      team abbreviation -> name and colors

FULL-GAME RULE
A game only counts if the quarterback played the whole game. Using play-by-play, a QB
qualifies when (a) he took at least 90% of his team's quarterback snaps that we can see
(dropbacks, kneel-downs, spikes) and (b) he appears in every one of the four quarters in
which his team's quarterbacks had a play. Starters who left hurt, were benched, or were
rested, and the backups who replaced them, are dropped.

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
TEAM_FIX = {"OAK": "LV", "SD": "LAC", "STL": "LA"}

GAME_COLS = [
    "player_id", "player_display_name", "player_name", "team", "opponent_team", "season", "week",
    "season_type", "position", "completions", "attempts", "passing_yards", "passing_tds",
    "passing_interceptions", "sacks_suffered", "sack_yards_lost",
    "sack_fumbles_lost", "rushing_fumbles_lost", "receiving_fumbles_lost", "carries", "rushing_yards", "rushing_tds",
    "gameday", "home", "team_score", "opp_score", "snap_share",
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
    """One row per (season, week, player_id): snap share among his team's QBs and quarters he appeared in."""
    pbp = to_polars(nfl.load_pbp(seasons=[season]))
    need = ["season", "week", "posteam", "qtr", "passer_player_id", "rusher_player_id", "qb_dropback", "qb_kneel", "qb_spike"]
    missing = [c for c in need if c not in pbp.columns]
    if missing:
        sys.exit(f"Play-by-play for {season} is missing columns: {missing}")
    p = pbp.select(need).filter(pl.col("posteam").is_not_null() & (pl.col("qtr") <= 4))
    # every play a quarterback is credited on, as passer or runner
    a = p.select("season", "week", "posteam", "qtr", pl.col("passer_player_id").alias("pid"),
                 ((pl.col("qb_dropback") == 1) | (pl.col("qb_kneel") == 1) | (pl.col("qb_spike") == 1)).alias("snap"))
    b = p.filter(pl.col("passer_player_id").is_null()).select(
        "season", "week", "posteam", "qtr", pl.col("rusher_player_id").alias("pid"),
        ((pl.col("qb_dropback") == 1) | (pl.col("qb_kneel") == 1) | (pl.col("qb_spike") == 1)).alias("snap"))
    plays = pl.concat([a, b]).filter(pl.col("pid").is_not_null() & pl.col("pid").is_in(list(qb_ids)))
    plays = plays.with_columns(pl.col("snap").fill_null(False))

    team_q = plays.group_by("season", "week", "posteam").agg(
        pl.col("snap").sum().alias("team_snaps"), pl.col("qtr").n_unique().alias("team_qtrs"))
    mine = plays.group_by("season", "week", "posteam", "pid").agg(
        pl.col("snap").sum().alias("my_snaps"), pl.col("qtr").n_unique().alias("my_qtrs"))
    out = mine.join(team_q, on=["season", "week", "posteam"], how="left").with_columns(
        (pl.col("my_snaps") / pl.when(pl.col("team_snaps") > 0).then(pl.col("team_snaps")).otherwise(None)).alias("snap_share"),
        (pl.col("my_qtrs") == pl.col("team_qtrs")).alias("all_qtrs"),
    )
    return out.select(
        pl.col("season").cast(pl.Int64), pl.col("week").cast(pl.Int64), pl.col("pid").alias("player_id"),
        "snap_share", "all_qtrs")


def schedule_lines():
    """Two rows per game (one per team): date, home/away, score for and against."""
    s = to_polars(nfl.load_schedules(seasons=True))
    s = s.filter(pl.col("home_score").is_not_null())
    fix = lambda c: pl.col(c).replace(TEAM_FIX)
    home = s.select(pl.col("season").cast(pl.Int64), pl.col("week").cast(pl.Int64), fix("home_team").alias("team"),
                    pl.col("gameday").cast(pl.Utf8), pl.lit(1).alias("home"),
                    pl.col("home_score").cast(pl.Int64).alias("team_score"), pl.col("away_score").cast(pl.Int64).alias("opp_score"))
    away = s.select(pl.col("season").cast(pl.Int64), pl.col("week").cast(pl.Int64), fix("away_team").alias("team"),
                    pl.col("gameday").cast(pl.Utf8), pl.lit(0).alias("home"),
                    pl.col("away_score").cast(pl.Int64).alias("team_score"), pl.col("home_score").cast(pl.Int64).alias("opp_score"))
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
    parts = []
    for season in seasons:
        part = qb_snaps_for_season(season, qb_ids)
        parts.append(part)
        print(f"  {season}: {part.height} QB appearances")
    snaps = pl.concat(parts).unique(subset=["season", "week", "player_id"])

    passers = passers.join(snaps, on=["season", "week", "player_id"], how="left")
    unverified = passers.filter(pl.col("snap_share").is_null()).height
    full = passers.filter((pl.col("snap_share") >= MIN_SNAP_SHARE) & pl.col("all_qtrs"))
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
