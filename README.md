# QB Game Rankings

Every full NFL quarterback game since 1999, ranked best to worst. The site rebuilds itself every Tuesday morning from nflverse.

Live site: https://qbranks.com

## What is on the page

- **How it works**: five short points at the top explaining the score.
- **Week recap**: the game of the week, the next four best, and the toughest day.
- **Big-time performances**: the best games of the last four weeks.
- **All-time rankings**: search by quarterback, team or season. Tap any game to see why it ranks where it does.

## The rules of the ranking

- Every game gets one score. 50 is average and every 10 points is one standard deviation.
- Eight categories count, with fixed weights: turnovers 1.2, passing yards 1.0, QBR 1.0 (passer rating before 2006), touchdown passes 0.8, defense faced 0.7, completion rate 0.6, rushing 0.5, sacks taken 0.4.
- Each category is compared with every other full game from the same season.
- **Full games only.** Using play-by-play, a quarterback qualifies when he took at least 90% of his team's quarterback snaps and appears in all four quarters. Quarterbacks who left hurt, were benched or rested, and the backups who replaced them, are left out. At least 10 pass attempts are also required.

## Files

| File | What it does |
| --- | --- |
| `index.html` | The page layout and styling. |
| `app.js` | Loads the data, scores every game and draws the page. No libraries, no build step. |
| `build_qb_games.py` | Downloads stats, play-by-play, schedules, photos and team colors from nflverse and writes the files in `data/`. |
| `.github/workflows/weekly-refresh.yml` | Runs the script every Tuesday at 7 am Eastern and republishes the site. Only the `main` branch publishes. |
| `qb-game-rankings.jsx` | The original version of the app, kept for reference. The site no longer uses it. |

## Running the refresh by hand

Open the **Actions** tab, pick **Weekly data refresh and deploy**, and click **Run workflow**. If GitHub pauses the schedule after a long quiet stretch, that same click turns it back on.

## Data notes

- Game stats, play-by-play, schedules, player photos and team colors come from nflverse.
- QBR comes from ESPN via nflverse, available from 2006.
- nflverse starts in 1999, so earlier seasons are not included.
