# QB Game Rankings

Every full NFL quarterback game since 1999, ranked best to worst. The site rebuilds itself every Tuesday morning from nflverse.

Live site: https://qbranks.com

## What is on the page

- **Rankings first**: the all-time list with search, season and playoff filters, best or worst first. Tap any game to see why it ranks where it does.
- **Side by side**: open a game, choose "Compare with another game", then tap any other game.
- **Week recap**: the game of the week, the best four after it, and the worst four.
- **Last 4 weeks**: big-time performances and the worst games.
- **Worst of all time**: the bottom of the list.
- **How it works**: six short points at the bottom of the page.

## The rules of the ranking

- Every game gets one score. 50 is average and 10 points is one standard deviation.
- **Eight stats**, each compared with every other game from the same season, with fixed weights: turnovers 1.2, passing yards 1.0, touchdown passes 1.0, completion rate 0.8, rushing yards 0.6, rushing touchdowns 0.6, yards per attempt 0.5, defense faced 0.5. Rushing can only help (never below average) and kneel-downs are removed first. Yards per attempt and rushing touchdowns are capped at three standard deviations. The stat rows are rescaled so their combined spread is 10 points.
- **The situation adds one point each**, never subtracts: win, road game, bad weather outdoors (32°F or colder, wind of 20 mph or more, rain or snow), game-winning drive, comeback win from 14 or more down, missing a regular top target (a player with at least 12% of the team's targets in nearby games who did not touch the ball, at least 10% combined).
- **The stakes**: a playoff win adds 1 more point, a Super Bowl win adds 2. All of these live in the `WEIGHTS` and `SITUATION` lines near the top of `app.js`.
- **Real games only.** Using play-by-play, a quarterback qualifies when he took at least 90% of his team's quarterback snaps and appears in all four quarters. Quarterbacks who left hurt or were rested, and the backups who replaced them, are left out. At least 10 pass attempts are also required.
- **Benched starters still count.** A starter who took the first snap, left in the second half while trailing by 14 or more, never returned, and has no injury noted on any play is treated as benched for poor play and kept.

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
- Games from 1932 to 1998 come from Pro-Football-Reference, exported once through a Stathead subscription into `data/qb_games_pre1999.json`. Play-by-play does not exist for those seasons, so the full-game check, weather, game-winning drives, comebacks and missing targets are not applied to them, and fumbles are only recorded from 1994. Every game with 10 or more pass attempts is included.
