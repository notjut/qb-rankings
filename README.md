# QB Game Rankings

Every NFL quarterback game since 1999, ranked best to worst with era- and defense-adjusted scoring, rebuilt automatically every week from nflverse.

## Files

| File | What it does |
| --- | --- |
| `index.html` | The site. Loads the app in the browser, no build step. |
| `qb-game-rankings.jsx` | The app itself (also works as a Claude artifact). |
| `build_qb_games.py` | Downloads every QB game line + QBR and writes `data/qb_games.json` and `data/qbr.json`. |
| `.github/workflows/weekly-refresh.yml` | Runs the script every Tuesday morning and republishes the site. |

## Set up (about 10 minutes, one time)

1. Create a new repository on GitHub (Public is fine; free Pages hosting requires it on a free account).
2. Upload these files, keeping the folder path `.github/workflows/weekly-refresh.yml` intact. Name the default branch `main`.
3. In the repository, open **Settings → Pages** and set **Source** to **GitHub Actions**.
4. Open the **Actions** tab, pick **Weekly data refresh and deploy**, and click **Run workflow**. The first run downloads all seasons (a few minutes) and publishes the site.
5. Your site is at `https://<your-username>.github.io/<repo-name>/`. Open it on any phone or computer.

From then on the workflow runs by itself every Tuesday at 7 am Eastern. If GitHub pauses the schedule after a long quiet stretch (it does this on inactive repositories), one click on **Run workflow** re-enables it. The app's **Check nflverse for new games** button also pulls the current season on demand.

## Run it on your own computer instead

```
pip install nflreadpy polars requests
python build_qb_games.py
python -m http.server 8000
```

Then open http://localhost:8000. Opening `index.html` directly as a file will not work; it has to be served.

## Adding 1932–1998

nflverse starts in 1999. For earlier seasons, export game logs from Stathead Football (Pro-Football-Reference's paid tool) with the Player Game Finder, then load each CSV through the app's Data tab; the column mapper handles their layout. Before 1932 no individual passing stats were recorded.

## Data notes

- Passing, rushing, sacks and lost fumbles come from nflverse `stats_player` (week level).
- QBR comes from ESPN via nflverse `espn_data`, available from 2006. Earlier games use passer rating in its place.
- Manual entries and hand-loaded CSVs persist in the Claude artifact version; on the hosted site they last for the session, since the site regenerates its data weekly.
