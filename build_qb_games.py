"""
build_qb_games.py
Pulls every NFL quarterback game line since 1999 from nflverse (free, community
maintained) plus ESPN's week-level QBR (2006 on), and writes:

  data/qb_games.json   compact dataset the app loads on startup
  data/qbr.json        QBR rows the app attaches to those games
  work/*.csv           the same data as CSV, for loading by hand or inspection

Run it on any computer with internet access, or let the GitHub Actions workflow
run it every week:

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

WORK_DIR = "work"
DATA_DIR = "data"
QBR_URL = "https://github.com/nflverse/nflverse-data/releases/download/espn_data/qbr_week_level.csv"

# Only the columns the app reads; either the current or the older nflverse names are kept if present.
GAME_COLS = [
    "player_display_name", "player_name", "team", "recent_team", "opponent_team", "season", "week",
    "season_type", "position", "completions", "attempts", "passing_yards", "passing_tds",
    "passing_interceptions", "interceptions", "sacks_suffered", "sacks", "sack_yards_lost", "sack_yards",
    "sack_fumbles_lost", "rushing_fumbles_lost", "receiving_fumbles_lost", "carries", "rushing_yards", "rushing_tds",
]
QBR_COLS = [
    "season", "season_type", "game_week", "team_abb", "name_short", "name_display", "name_first", "name_last",
    "qbr_total", "qbr_raw",
]


def load_all_player_weeks():
    """All seasons, one row per player per game. Handles both nflreadpy signatures."""
    try:
        return nfl.load_player_stats(seasons=True, summary_level="week")
    except TypeError:
        return nfl.load_player_stats(seasons=True)


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
        json.dump(payload, f, separators=(",", ":"), allow_nan=False)
    return len(payload["rows"])


def main():
    os.makedirs(WORK_DIR, exist_ok=True)
    os.makedirs(DATA_DIR, exist_ok=True)
    today = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d")

    print("Downloading player game stats for every season since 1999 (this takes a minute)...")
    stats = load_all_player_weeks()
    if not isinstance(stats, pl.DataFrame):
        stats = pl.from_pandas(stats)
    if "attempts" not in stats.columns:
        sys.exit("Unexpected columns from nflreadpy; expected an 'attempts' column. Columns: " + ", ".join(stats.columns))

    passers = stats.filter(pl.col("attempts") > 0)
    if "position" in passers.columns:
        passers = passers.filter((pl.col("position") == "QB") | pl.col("position").is_null())
    passers = passers.sort(["season", "week"])

    passers.write_csv(os.path.join(WORK_DIR, "qb_games_1999_to_now.csv"))
    n = write_json(passers, GAME_COLS, os.path.join(DATA_DIR, "qb_games.json"), {"built": today, "source": "nflverse stats_player"})
    lo, hi = passers.select(pl.col("season").min(), pl.col("season").max()).row(0)
    print(f"Wrote data/qb_games.json: {n:,} QB game lines, seasons {lo}-{hi}")

    print("Downloading ESPN week-level QBR...")
    resp = requests.get(QBR_URL, timeout=180)
    if resp.status_code != 200:
        print(f"Could not fetch QBR (HTTP {resp.status_code}). Games were still written; QBR keeps its previous file if one exists. "
              "Check https://github.com/nflverse/nflverse-data/releases/tag/espn_data for the week-level QBR file.")
        return
    qbr = pl.read_csv(io.BytesIO(resp.content), infer_schema_length=10000)
    qbr.write_csv(os.path.join(WORK_DIR, "qbr_week_level.csv"))
    m = write_json(qbr, QBR_COLS, os.path.join(DATA_DIR, "qbr.json"), {"built": today, "source": "ESPN via nflverse espn_data"})
    print(f"Wrote data/qbr.json: {m:,} QBR rows")
    print("Done.")


if __name__ == "__main__":
    main()
