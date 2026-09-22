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

- Every game gets one score. 50 is average and every 10 points is one standard deviation.
- Nine stat categories count, with fixed weights: turnovers 1.2, yards per attempt 1.0, touchdown passes 0.8, passing yards 0.7, defense faced 0.7, completion rate 0.5, QBR 0.5 (passer rating before 2006), rushing 0.5, sacks taken 0.4. Each is compared with every other game from the same season. QBR is kept at half weight because it already reflects most of the other stats.
- **Rushing can only help.** A quarterback's rushing is scored as average or better, never below average, so pocket passers are not punished for a quiet day. Kneel-downs are removed from rushing yards first.
- **The situation adds flat points on top**: win +2, loss -2, road +1, home -1, neutral site 0, game-winning drive +2, freezing (32°F or colder) +2, wind of 20 mph or more +2, rain or snow +1.5, with weather capped at +4 and only counted outdoors, and missing regular targets +10 per share of the team's targets they normally draw, capped at +3. These live in the `SITUATION` line near the top of `app.js`.
- **Missing targets** are found from play-by-play. A "regular" is a player with at least 12% of the team's targets across the team's games within six of the game in question, present in at least 60% of those games, who did not touch the ball in this one. Judging against nearby games means a receiver who only became a starter mid-season is not counted as missing before that.
- **The stakes.** A playoff game adds points for playing (wild card 1, divisional 1, conference 1.5, Super Bowl 2) and more for winning (1, 1.5, 2, 4), on top of the normal 2 for a win. A comeback win adds 1 point from 10 or more down, 2 from 14, 3 from 21, 4 from 25. These live in the `STAKES` and `COMEBACK` lines in `app.js`.
- **Calibration.** The nine stat rows are rescaled so their combined spread is 10 points and the list averages about 50. The situation and stakes points are added at face value afterwards. Yards per attempt is capped at three standard deviations because it runs wild on a few attempts.
- **Real games only.** Using play-by-play, a quarterback qualifies when he took at least 90% of his team's quarterback snaps and appears in all four quarters. Quarterbacks who left hurt or were rested, and the backups who replaced them, are left out. At least 10 pass attempts are also required.
- **Benched starters still count.** A starter who took the first snap, left in the second half while trailing by 14 or more, never returned, and has no injury noted on any play is treated as benched for poor play and kept.
- A game-winning drive means the offense took the lead for good in the 4th quarter or overtime.

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
