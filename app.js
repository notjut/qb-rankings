/* QB Game Rankings: loads the weekly data files, scores every full game, draws the page. No libraries. */
(function () {
  "use strict";

  /* ---------- the model (fixed; visitors cannot change it) ---------- */
  const WEIGHTS = { to: 1.2, yds: 1.0, td: 1.0, cmp: 0.8, ry: 0.6, rtd: 0.6, ypa: 0.5, def: 0.5 };
  const COMPONENTS = [
    { key: "yds", stat: "yds", label: "Passing yards", sign: 1 },
    { key: "td", stat: "td", label: "Touchdown passes", sign: 1 },
    { key: "to", stat: "to", label: "Turnovers", sign: -1 },
    { key: "cmp", stat: "cmpPct", label: "Completion rate", sign: 1 },
    { key: "ry", stat: "ry", label: "Rushing yards", sign: 1 },
    { key: "rtd", stat: "rtd", label: "Rushing touchdowns", sign: 1 },
    { key: "ypa", stat: "ypa", label: "Yards per attempt", sign: 1 },
    { key: "def", stat: null, label: "Defense faced", sign: 1 },
  ];
  const STAT_KEYS = ["yds", "ypa", "cmpPct", "td", "to", "ry", "rtd"];
  const Z_CAP = 3;
  const MIN_ATT = 10, MIN_POOL = 60, MIN_DEF_GAMES = 6, FIRST_PAGE = 10, PAGE = 50, BIG_TIME = 70, RECENT_WEEKS = 4;
  // the situation: flat points added on top of the eight stat categories
  const SITUATION = { win: 1, loss: 0, road: 1, home: 0, gwd: 1, weather: 1, missing: 1, missingMinShare: 0.1, comeback: 1, comebackFrom: 14, playoffWin: 1, superBowlWin: 2 };

  /* ---------- helpers ---------- */
  const $ = (id) => document.getElementById(id);
  const nz = (a, b) => (a === null || a === undefined ? b : a);
  const num = (v) => { if (v === null || v === undefined || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
  const esc = (s) => String(nz(s, "")).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const int = (n) => Math.round(n).toLocaleString("en-US");
  const one = (n) => (Math.round(n * 10) / 10).toFixed(1);
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const joinAnd = (a) => (a.length <= 1 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`);
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtDate(d) { const m = String(d || "").match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); return m ? `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}` : ""; }
  function passerRating(cmp, att, yds, td, ints) {
    if (!att) return null;
    const a = clamp((cmp / att - 0.3) * 5, 0, 2.375), b = clamp((yds / att - 3) * 0.25, 0, 2.375);
    const c = clamp((td / att) * 20, 0, 2.375), d = clamp(2.375 - (ints / att) * 25, 0, 2.375);
    return ((a + b + c + d) / 6) * 100;
  }

  /* ---------- teams ---------- */
  const NICK = {
    ARI: "Cardinals", ATL: "Falcons", BAL: "Ravens", BUF: "Bills", CAR: "Panthers", CHI: "Bears", CIN: "Bengals", CLE: "Browns",
    DAL: "Cowboys", DEN: "Broncos", DET: "Lions", GB: "Packers", HOU: "Texans", IND: "Colts", JAX: "Jaguars", KC: "Chiefs",
    LA: "Rams", STL: "Rams", LAC: "Chargers", SD: "Chargers", LV: "Raiders", OAK: "Raiders", MIA: "Dolphins", MIN: "Vikings",
    NE: "Patriots", NO: "Saints", NYG: "Giants", NYJ: "Jets", PHI: "Eagles", PIT: "Steelers", SEA: "Seahawks", SF: "49ers",
    TB: "Buccaneers", TEN: "Titans", WAS: "Commanders",
  };
  const CANON = { WSH: "WAS", LAR: "LA", JAC: "JAX", GNB: "GB", KAN: "KC", NWE: "NE", NOR: "NO", SFO: "SF", TAM: "TB", SDG: "SD", LVR: "LV", RAI: "OAK", RAM: "LA", OTI: "TEN", CRD: "ARI", CLT: "IND", HTX: "HOU", RAV: "BAL", PHO: "ARI", PHX: "ARI" };
  function normTeam(code, season) {
    let u = String(code || "").toUpperCase().trim();
    if (!u) return "UNK";
    u = CANON[u] || u;
    if (u === "OAK" && season >= 2020) u = "LV";
    if (u === "LV" && season < 2020) u = "OAK";
    if (u === "LA" && season >= 1995 && season <= 2015) u = "STL";
    if (u === "STL" && season > 2015) u = "LA";
    if (u === "SD" && season >= 2017) u = "LAC";
    if (u === "LAC" && season <= 2016) u = "SD";
    return u;
  }
  // names for defunct teams and earlier identities, keyed by the abbreviation in the data
  const OLD_NICK = {
    PRT: "Spartans", BKN: "Dodgers", BDA: "Dodgers", BCL: "Colts", BOS: "Yanks", NYY: "Yanks", NYB: "Bulldogs", CHR: "Rockets", LAD: "Dons",
    SIS: "Gunners", STL: "Gunners", DTX: "Texans", NYT: "Titans", MIA46: "Seahawks", CIN33: "Reds", CLE_RAMS: "Rams", HOU_OIL: "Oilers", TEN_OIL: "Oilers",
    CHL: "Cardinals", ABU: "Steam Roller", PTB: "Steam Roller", BFF: "Bisons", CBD: "Bulldogs", CRA: "Rams", CST: "Stapletons", BRL: "Lions", BBA: "Braves",
    CTI: "Tigers", CLI: "Indians", CLP: "Panthers", COL: "Tigers", RED: "Reds", CNC: "Celts", CIB: "Bulldogs", CHB: "Bears", CHT: "Tigers", CCL: "Cardinals", AKR: "Pros", ATN: "Yellow Jackets", BYK: "Yanks",
  };
  function nick(code, season) {
    if (code === "WAS") return season >= 2022 ? "Commanders" : season >= 2020 ? "Washington" : season <= 1932 ? "Braves" : "Redskins";
    if (code === "TEN" && season <= 1998) return "Oilers";
    if (code === "HOU" && season <= 1996) return "Oilers";
    if (code === "CLE" && season <= 1945) return "Rams";
    if (code === "CIN" && season <= 1940) return "Reds";
    if (code === "MIA" && season <= 1946) return "Seahawks";
    if (code === "BOS") return season <= 1936 ? "Redskins" : season >= 1960 ? "Patriots" : "Yanks";
    if (code === "BUF" && season <= 1946) return "Bisons";
    if (code === "STL") return season <= 1934 ? "Gunners" : season <= 1987 ? "Cardinals" : "Rams";
    if (code === "BAL" && season <= 1983) return "Colts";
    if (code === "CHH") return "Hornets";
    if (code === "NYY" && season <= 1949) return "Yankees";
    return NICK[code] || OLD_NICK[code] || code || "?";
  }
  let TEAMS = {};
  function colors(code, season) {
    // earlier identities borrow the colors of the franchise they became
    if (code === "STL" && season <= 1987) code = "ARI";
    if (code === "BAL" && season <= 1983) code = "IND";
    if (code === "BOS") code = season >= 1960 ? "NE" : "WAS";
    if (code === "DTX") code = "KC";
    if (code === "NYT") code = "NYJ";
    if (code === "PRT") code = "DET";
    if (code === "HOU" && season <= 1996) code = "TEN";
    const t = TEAMS[code] || TEAMS[{ STL: "LA", SD: "LAC", OAK: "LV" }[code]] || {};
    return { c1: t.color || "#111111", c2: t.color2 || "#999999" };
  }
  function readableOn(hex) {
    const m = String(hex).replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m) return "#fff";
    const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16));
    return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? "#000" : "#fff";
  }
  function nameKey(name) {
    const n = String(name || "").replace(/\./g, " ").replace(/[^A-Za-z' \-]/g, " ").trim();
    const parts = n.split(/\s+/).filter((p) => p && !/^(jr|sr|ii|iii|iv|v)$/i.test(p));
    if (!parts.length) return "";
    const last = parts[parts.length - 1].toLowerCase().replace(/[^a-z]/g, "");
    return parts.length > 1 ? `${last}|${parts[0][0].toLowerCase()}` : last;
  }

  /* ---------- data loading ---------- */
  async function getJson(path) {
    try { const res = await fetch(path, { cache: "no-cache" }); return res.ok ? await res.json() : null; } catch (e) { return null; }
  }
  function buildRows(data) {
    const H = data.headers, ix = (n) => H.indexOf(n);
    const I = {
      pid: ix("player_id"), player: ix("player_display_name"), short: ix("player_name"), team: ix("team"), opp: ix("opponent_team"),
      season: ix("season"), week: ix("week"), st: ix("season_type"), cmp: ix("completions"), att: ix("attempts"), yds: ix("passing_yards"),
      td: ix("passing_tds"), int: ix("passing_interceptions"), sk: ix("sacks_suffered"), skY: ix("sack_yards_lost"),
      f1: ix("sack_fumbles_lost"), f2: ix("rushing_fumbles_lost"), f3: ix("receiving_fumbles_lost"), ra: ix("carries"), ry: ix("rushing_yards"),
      rtd: ix("rushing_tds"), date: ix("gameday"), home: ix("home"), ts: ix("team_score"), os: ix("opp_score"), share: ix("snap_share"),
      neutral: ix("neutral"), roof: ix("roof"), temp: ix("temp"), wind: ix("wind"), precip: ix("precip"), gwd: ix("gwd"),
      benched: ix("benched"), exitQ: ix("exit_qtr"), exitM: ix("exit_margin"), verified: ix("verified"), kneel: ix("kneel_yards"), missShare: ix("missing_share"), missNames: ix("missing_names"), comeback: ix("comeback"),
    };
    const g = (row, i) => (i < 0 ? null : row[i]);
    const out = [];
    for (const row of data.rows) {
      const season = num(g(row, I.season)), att = num(g(row, I.att)) || 0;
      const player = String(nz(g(row, I.player), nz(g(row, I.short), ""))).trim();
      if (!season || att <= 0 || !player) continue;
      const st = String(nz(g(row, I.st), "REG")).toUpperCase().startsWith("POST") ? "POST" : "REG";
      const week = num(g(row, I.week));
      const team = normTeam(g(row, I.team), season), opp = normTeam(g(row, I.opp), season);
      const fl = [g(row, I.f1), g(row, I.f2), g(row, I.f3)].map(num).filter((v) => v !== null);
      out.push({
        id: `${season}-${week}-${team}-${nz(g(row, I.pid), nameKey(player))}`, pid: g(row, I.pid), player, team, opp, season, week, st,
        cmp: num(g(row, I.cmp)) || 0, att, yds: num(g(row, I.yds)) || 0, td: num(g(row, I.td)) || 0, int: num(g(row, I.int)) || 0,
        sk: num(g(row, I.sk)) || 0, skY: Math.abs(num(g(row, I.skY)) || 0), fl: fl.length ? fl.reduce((a, b) => a + b, 0) : 0,
        ra: num(g(row, I.ra)) || 0, ry: num(g(row, I.ry)) || 0, rtd: num(g(row, I.rtd)) || 0,
        date: g(row, I.date), home: num(g(row, I.home)), ts: num(g(row, I.ts)), os: num(g(row, I.os)), share: num(g(row, I.share)),
        neutral: num(g(row, I.neutral)) === 1, roof: g(row, I.roof), temp: num(g(row, I.temp)), wind: num(g(row, I.wind)), precip: g(row, I.precip),
        gwd: num(g(row, I.gwd)) === 1, benched: num(g(row, I.benched)) === 1, exitQ: num(g(row, I.exitQ)), exitM: num(g(row, I.exitM)),
        verified: I.verified < 0 ? true : num(g(row, I.verified)) !== 0, kneel: num(g(row, I.kneel)) || 0, missShare: num(g(row, I.missShare)), missNames: g(row, I.missNames), comeback: num(g(row, I.comeback)) || 0,
        qbr: null,
      });
    }
    return out;
  }
  function attachQbr(rows, data) {
    if (!data || !data.rows) return;
    const H = data.headers, ix = (n) => H.indexOf(n);
    const iS = ix("season"), iT = ix("season_type"), iW = ix("game_week"), iTeam = ix("team_abb"), iDisp = ix("name_display"), iQ = ix("qbr_total");
    const round = (r) => r.week - (r.season >= 2021 ? 18 : 17); // playoffs: 1 wild card, 2 divisional, 3 conference, 4 Super Bowl
    const map = new Map();
    for (const r of rows) map.set(`${r.season}|${r.st}|${r.st === "POST" ? round(r) : r.week}|${r.team}|${nameKey(r.player)}`, r);
    for (const row of data.rows) {
      const season = num(row[iS]), q = num(row[iQ]);
      if (!season || q === null) continue;
      const type = String(nz(row[iT], "")).toUpperCase();
      const st = type.startsWith("POST") || type.startsWith("PLAY") ? "POST" : "REG";
      const r = map.get(`${season}|${st}|${num(row[iW])}|${normTeam(row[iTeam], season)}|${nameKey(row[iDisp])}`);
      if (r) r.qbr = q;
    }
  }

  /* ---------- scoring ---------- */
  function derive(r) {
    const den = r.att + r.sk;
    const ryReal = r.ry - r.kneel; // kneel-downs are not rushing attempts in any meaningful sense
    return {
      cmpPct: (r.cmp / r.att) * 100, ypa: r.yds / r.att, to: r.int + r.fl, ryReal,
      ry: Math.max(0, ryReal), rtd: r.rtd,
      any: den > 0 ? (r.yds + 20 * r.td - 45 * r.int - r.skY) / den : null,
    };
  }
  function situation(r) {
    const items = [];
    if (r.ts !== null && r.os !== null && r.ts !== r.os) {
      const won = r.ts > r.os;
      if (won) items.push({ key: "result", label: "Won the game", detail: `${r.ts}–${r.os}`, pts: SITUATION.win, phrase: "winning the game" });
      if (won && r.st === "POST") {
        const sb = weekLabel(r) === "Super Bowl" || weekLabel(r) === "Championship game";
        items.push({ key: "stakes", label: sb ? "Super Bowl win" : "Playoff win", detail: weekLabel(r), pts: sb ? SITUATION.superBowlWin : SITUATION.playoffWin, phrase: sb ? "winning the Super Bowl" : "winning a playoff game" });
      }
    }
    if (r.comeback >= SITUATION.comebackFrom) items.push({ key: "comeback", label: "Comeback win", detail: `Trailed by ${r.comeback}`, pts: SITUATION.comeback, phrase: `a comeback from ${r.comeback} down` });
    if (r.gwd) items.push({ key: "gwd", label: "Game-winning drive", detail: "Took the lead for good late", pts: SITUATION.gwd, phrase: "a game-winning drive" });
    if (!r.neutral && r.home === 0) items.push({ key: "venue", label: "Road game", detail: "Away from home", pts: SITUATION.road, phrase: "playing on the road" });
    if (r.missShare >= SITUATION.missingMinShare) {
      const names = String(r.missNames || "").split(", ").filter(Boolean);
      items.push({ key: "missing", label: "Missing a top target", detail: names.join(", "), pts: SITUATION.missing, phrase: `playing without ${names.length > 1 ? "regular targets " : "a regular target, "}${joinAnd(names)}` });
    }
    const outdoors = r.roof === "outdoors" || r.roof === "open" || (!r.roof && r.temp !== null);
    if (outdoors) {
      const bits = [];
      if (r.temp !== null && r.temp <= 32) bits.push(`${Math.round(r.temp)}°F`);
      if (r.wind !== null && r.wind >= 20) bits.push(`${Math.round(r.wind)} mph wind`);
      if (r.precip) bits.push(r.precip);
      if (bits.length) items.push({ key: "weather", label: "Bad weather", detail: bits.join(" · "), pts: SITUATION.weather, phrase: `bad weather (${bits.join(", ")})` });
    }
    return items;
  }
  function computeModel(rows) {
    const add = (acc, k, v) => { if (v === null || v === undefined || !Number.isFinite(v)) return; const a = acc[k] || (acc[k] = { n: 0, s: 0, ss: 0 }); a.n++; a.s += v; a.ss += v * v; };
    const stats = (a, pool) => { if (!a || a.n < 2) return null; const m = a.s / a.n; return { m, sd: Math.sqrt(Math.max(a.ss / a.n - m * m, 0)), n: a.n, pool }; };
    const qual = rows.filter((r) => r.att >= MIN_ATT);
    const derived = new Map(qual.map((r) => [r, derive(r)]));
    const seasonAcc = new Map(), decadeAcc = new Map(), globalAcc = {}, defBySeason = new Map();
    for (const r of qual) {
      const d = derived.get(r);
      const vals = { yds: r.yds, ypa: d.ypa, cmpPct: d.cmpPct, td: r.td, to: d.to, ry: d.ry, rtd: d.rtd };
      if (!seasonAcc.has(r.season)) seasonAcc.set(r.season, {});
      const dec = Math.floor(r.season / 10) * 10;
      if (!decadeAcc.has(dec)) decadeAcc.set(dec, {});
      for (const k of STAT_KEYS) { add(seasonAcc.get(r.season), k, vals[k]); add(decadeAcc.get(dec), k, vals[k]); add(globalAcc, k, vals[k]); }
      if (d.any !== null) {
        if (!defBySeason.has(r.season)) defBySeason.set(r.season, { n: 0, s: 0, teams: new Map() });
        const ds = defBySeason.get(r.season); ds.n++; ds.s += d.any;
        if (!ds.teams.has(r.opp)) ds.teams.set(r.opp, { n: 0, s: 0 });
        const t = ds.teams.get(r.opp); t.n++; t.s += d.any;
      }
    }
    const defInfo = new Map();
    for (const [season, ds] of defBySeason) {
      const mean = ds.s / ds.n;
      const teams = [...ds.teams.entries()].map(([code, t]) => ({ code, n: t.n, allowed: t.s / t.n })).filter((t) => t.n >= MIN_DEF_GAMES).sort((a, b) => a.allowed - b.allowed);
      const diffs = teams.map((t) => mean - t.allowed);
      let sd = null;
      if (diffs.length >= 2) { const dm = diffs.reduce((a, x) => a + x, 0) / diffs.length; sd = Math.sqrt(diffs.reduce((a, x) => a + (x - dm) * (x - dm), 0) / diffs.length); if (sd < 1e-6) sd = null; }
      defInfo.set(season, { mean, sd, rank: new Map(teams.map((t, i) => [t.code, i + 1])), count: teams.length, teams: ds.teams });
    }
    const cache = new Map();
    const base = (season, key) => {
      const ck = `${season}|${key}`;
      if (cache.has(ck)) return cache.get(ck);
      const ok = (st) => (st && st.n >= MIN_POOL ? st : null);
      const b = ok(stats((seasonAcc.get(season) || {})[key], "season")) || ok(stats((decadeAcc.get(Math.floor(season / 10) * 10) || {})[key], "decade")) || stats(globalAcc[key], "all");
      cache.set(ck, b || null);
      return b || null;
    };
    const wsq = Math.sqrt(Object.values(WEIGHTS).reduce((a, w) => a + w * w, 0));
    const scored = [];
    for (const r of qual) {
      const d = derived.get(r), z = {}, avg = {};
      let pool = null;
      const zv = (key, statKey, v) => {
        if (v === null || v === undefined) return null;
        const b = base(r.season, statKey);
        if (!b || !b.sd) return null;
        if (!pool) pool = b.pool;
        avg[key] = b.m;
        const zz = (v - b.m) / b.sd;
        return key === "ypa" || key === "rtd" ? clamp(zz, -Z_CAP, Z_CAP) : zz; // these two run wild on small numbers, so they are capped
      };
      z.yds = zv("yds", "yds", r.yds); z.cmp = zv("cmp", "cmpPct", d.cmpPct); z.td = zv("td", "td", r.td); z.to = zv("to", "to", d.to);
      z.ypa = zv("ypa", "ypa", d.ypa);
      // rushing can only help: a quarterback who does not run is scored as average, never below
      z.ry = zv("ry", "ry", d.ry); if (z.ry !== null && z.ry < 0) z.ry = 0;
      z.rtd = zv("rtd", "rtd", d.rtd); if (z.rtd !== null && z.rtd < 0) z.rtd = 0;
      let defRank = null, defCount = null; z.def = null;
      const di = defInfo.get(r.season);
      if (di && d.any !== null) {
        const t = di.teams.get(r.opp);
        if (t && t.n - 1 >= MIN_DEF_GAMES && di.sd) z.def = (di.mean - (t.s - d.any) / (t.n - 1)) / di.sd; // defense judged on its other games
        defRank = di.rank.get(r.opp) || null; defCount = di.count;
      }
      const pts = {};
      let total = 0;
      for (const c of COMPONENTS) { pts[c.key] = z[c.key] === null ? null : (10 * c.sign * WEIGHTS[c.key] * z[c.key]) / wsq; total += pts[c.key] || 0; }
      const hay = `${r.player} ${r.team} ${nick(r.team, r.season)} ${r.opp} ${nick(r.opp, r.season)} ${r.season} week ${r.week} ${r.st === "POST" ? "playoffs postseason " + weekLabel(r) : "regular"}`.toLowerCase();
      const sit = situation(r);
      for (const it of sit) total += it.pts;
      scored.push({ r, d, z, pts, avg, sit, score: 50 + total, defRank, defCount, pool, hay });
    }
    // Calibrate so the whole list really does average 50 with a spread of 10. The stat categories overlap
    // (a big yardage day also lifts yards per attempt and QBR), so their raw sum spreads wider than 10.
    // Only the stat rows are rescaled, so the situation and stakes points keep their face values.
    const n = scored.length;
    const statTotal = (s) => COMPONENTS.reduce((a, c) => a + (s.pts[c.key] || 0), 0);
    const mean = scored.reduce((a, s) => a + statTotal(s), 0) / n;
    const sd = Math.sqrt(scored.reduce((a, s) => a + (statTotal(s) - mean) ** 2, 0) / n) || 10;
    const k = 10 / sd;
    const floor = 50 - mean * k;
    for (const s of scored) {
      for (const key in s.pts) if (s.pts[key] !== null) s.pts[key] *= k;
      s.base = floor; // where a game with zero points in every row lands
      s.score = floor + statTotal(s) + s.sit.reduce((a, it) => a + it.pts, 0);
    }
    scored.sort((a, b) => b.score - a.score || b.r.yds - a.r.yds);
    scored.forEach((s, i) => { s.rank = i + 1; });
    window.__qb = { mean, sd, k, scored };
    return scored;
  }

  /* ---------- wording ---------- */
  function weekLabel(r) {
    if (r.st !== "POST") return `Week ${r.week}`;
    const i = r.week - (r.season >= 2021 ? 18 : 17);
    if (r.season < 1966) return i >= 4 ? "Championship game" : i === 3 ? "Conference playoff" : "Playoffs";
    return ["Wild card", "Divisional round", "Conference championship", "Super Bowl"][i - 1] || "Playoffs";
  }
  function resultText(r) {
    if (r.ts === null || r.os === null) return "";
    return `${r.ts > r.os ? "Won" : r.ts < r.os ? "Lost" : "Tied"} ${r.ts}–${r.os}`;
  }
  const matchup = (r) => `${nick(r.team, r.season)} ${r.home === 0 && weekLabel(r) !== "Super Bowl" ? "at" : "vs"} ${nick(r.opp, r.season)}`;
  const when = (r) => `${r.season} ${weekLabel(r)}`;
  function statLine(r) {
    const bits = [`${r.cmp}/${r.att}`, `${int(r.yds)} yds`, `${r.td} TD`, `${r.int} INT`];
    const ry = r.ry - r.kneel;
    if (ry > 0 || r.rtd) bits.push(`${ry} rush yds${r.rtd ? `, ${r.rtd} rush TD` : ""}`);
    return bits.join(" · ");
  }
  function tags(r) {
    const t = [], outside = r.roof === "outdoors" || r.roof === "open";
    if (r.comeback >= 14) t.push(`Comeback from ${r.comeback} down`);
    else if (r.gwd) t.push("Game-winning drive");
    if (outside && r.temp !== null && r.temp <= 32) t.push(`${Math.round(r.temp)}°F`);
    if (outside && r.precip) t.push(r.precip);
    if (r.benched) t.push("Benched");
    if (r.missShare >= 0.15) t.push("Short-handed");
    return t;
  }
  function topPct(s, N) { const p = (s.rank / N) * 100; return p <= 1 ? "Top 1%" : p <= 50 ? `Top ${Math.ceil(p)}%` : `Bottom ${Math.max(1, Math.ceil(100 - p))}%`; }
  function phrase(s, key) {
    const r = s.r, d = s.d, good = s.pts[key] > 0;
    switch (key) {
      case "yds": return `${int(r.yds)} passing yards`;
      case "td": return r.td === 0 ? "no touchdown passes" : plural(r.td, "touchdown pass").replace("passs", "passes");
      case "to": return d.to === 0 ? "no turnovers" : plural(d.to, "turnover");
      case "cmp": return `${Math.round(d.cmpPct)}% completions`;
      case "ypa": return `${one(d.ypa)} yards per attempt`;
      case "ry": return `${d.ryReal} rushing yards`;
      case "rtd": return plural(r.rtd, "rushing touchdown");
      case "def": return `${good ? "a tough" : "a soft"} ${nick(r.opp, r.season)} defense${s.defRank ? ` (#${s.defRank} of ${s.defCount} against quarterbacks that year)` : ""}`;
    }
    return key;
  }
  function explain(s, N) {
    const all = COMPONENTS.map((c) => c.key).filter((k) => s.pts[k] !== null).map((k) => ({ pts: s.pts[k], text: phrase(s, k) }))
      .concat(s.sit.map((it) => ({ pts: it.pts, text: it.phrase })));
    const helped = all.filter((x) => x.pts >= 1.5).sort((a, b) => b.pts - a.pts).slice(0, 4).map((x) => x.text);
    const hurt = all.filter((x) => x.pts <= -1.5).sort((a, b) => a.pts - b.pts).slice(0, 4).map((x) => x.text);
    const better = ((N - s.rank) / N) * 100;
    const out = [`Ranked #${int(s.rank)} of ${int(N)} games. Better than ${better >= 99.95 ? "99.9" : better < 0.05 ? "0" : one(better)}% of them.`];
    out.push(helped.length ? `What lifted it: ${joinAnd(helped)}.` : "Nothing stood out on the plus side.");
    out.push(hurt.length ? `What held it back: ${joinAnd(hurt)}.` : "Nothing held it back.");
    return out;
  }

  /* ---------- pieces of page ---------- */
  let HEADS = {};
  function photo(s, width, stripe) {
    const r = s.r, { c1, c2 } = colors(r.team, r.season);
    const initials = r.player.split(/\s+/).map((p) => p[0]).slice(0, 2).join("");
    let url = HEADS[r.pid] || "";
    if (url) url = url.replace("f_auto,q_auto", `f_auto,q_auto,w_${width}`);
    return `<span class="ph" style="background:${esc(c1)}"><span class="ini" style="color:${readableOn(c1)}">${esc(initials)}</span>` +
      (url ? `<img src="${esc(url)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : "") +
      (stripe ? `<span class="stripe" style="background:${esc(c2)}"></span>` : "") + `</span>`;
  }
  const tagText = (r) => { const t = tags(r); return t.length ? ` · ${t.join(" · ")}` : ""; };
  function card(s, N, tag) {
    const r = s.r;
    return `<button type="button" class="card" data-id="${esc(r.id)}">${photo(s, 480, true)}
      <span class="row1"><span>${esc(r.player)}</span><span>${one(s.score)}</span></span>
      <span class="meta" style="display:block">${esc(matchup(r))} · ${esc(tag || when(r))}</span>
      <span class="meta" style="display:block">${esc(statLine(r))}</span>
      <span class="meta" style="display:block">All-time #${int(s.rank)} · ${topPct(s, N)}${esc(tagText(r))}</span></button>`;
  }
  const grid = (list, N, tagFn) => `<div class="grid">${list.map((s, i) => card(s, N, tagFn ? tagFn(s, i) : null)).join("")}</div>`;

  function renderWeek(scored, N, latest) {
    const games = scored.filter((s) => s.r.season === latest.season && s.r.week === latest.week);
    const shown = new Set();
    if (!games.length) { $("week").hidden = true; return shown; }
    const top = games[0], r = top.r;
    const label = r.st === "POST" ? weekLabel(r) : `Week ${latest.week}`;
    let html = `<h2>${esc(label)} recap <span>${latest.season} season · ${plural(games.length, "game")}</span></h2>
      <button type="button" class="hero" data-id="${esc(r.id)}">${photo(top, 960, true)}
        <span><span class="tag" style="display:block">Game of the week</span>
        <span class="name" style="display:block">${esc(r.player)}</span>
        <span style="display:block">${esc(matchup(r))}${resultText(r) ? " · " + esc(resultText(r)) : ""}</span>
        <span class="meta" style="display:block">${esc(statLine(r))}${esc(tagText(r))}</span>
        <span class="big" style="display:block">${one(top.score)}</span>
        <span class="meta" style="display:block">All-time #${int(top.rank)} of ${int(N)} · ${topPct(top, N)}</span>
        <span class="why-link">See why</span></span></button>`;
    const best = games.slice(1, 5);
    if (best.length) html += `<h3 class="subhead">Best of the week</h3>${grid(best, N, (s, i) => `#${i + 2} this week`)}`;
    const worst = games.length >= 9 ? games.slice(-4).reverse() : [];
    if (worst.length) html += `<h3 class="subhead">Worst of the week</h3>${grid(worst, N, (s, i) => (i === 0 ? "Lowest this week" : `#${i + 1} lowest this week`))}`;
    $("weekBody").innerHTML = html;
    [top, ...best, ...worst].forEach((s) => shown.add(s));
    return shown;
  }
  function renderRecent(scored, N, latest, shown) {
    const pool = scored.filter((s) => s.r.season === latest.season && s.r.week > latest.week - RECENT_WEEKS && !shown.has(s));
    let picks = pool.filter((s) => s.score >= BIG_TIME);
    if (picks.length < 4) picks = pool.slice(0, 4);
    picks = picks.slice(0, 8);
    const taken = new Set(picks);
    const worst = pool.filter((s) => !taken.has(s)).slice(-4).reverse();
    if (!picks.length) { $("recent").hidden = true; return; }
    $("recentBody").innerHTML = `<h2>Last ${RECENT_WEEKS} weeks <span>${latest.season} season</span></h2>
      <h3 class="subhead" style="margin-top:0">Big-time performances</h3>${grid(picks, N)}` +
      (worst.length ? `<h3 class="subhead">Worst of the last ${RECENT_WEEKS} weeks</h3>${grid(worst, N)}` : "");
  }
  const GOAT_BAR = 70, GOAT_HIGH = 80, GOAT_COUNT = 150, GOAT_FIRST = 25;
  function buildGoats(scored) {
    const byName = new Map();
    for (const s of scored) {
      const key = s.r.player.toLowerCase().replace(/[^a-z]/g, "");
      let p = byName.get(key);
      if (!p) { p = { name: s.r.player, games: 0, great: 0, historic: 0, playoffWins: 0, titles: 0, sum: 0, best: s, first: s.r.season, last: s.r.season, teams: new Map(), photoGame: null }; byName.set(key, p); }
      p.games++; p.sum += s.score;
      if (s.score >= GOAT_BAR) p.great++;
      const stake = s.sit.find((it) => it.key === "stakes");
      if (stake) { if (stake.label === "Super Bowl win") p.titles++; else p.playoffWins++; }
      if (s.score >= GOAT_HIGH) p.historic++;
      if (s.score > p.best.score) p.best = s;
      if (s.r.season < p.first) p.first = s.r.season;
      if (s.r.season > p.last) p.last = s.r.season;
      p.teams.set(s.r.team, (p.teams.get(s.r.team) || 0) + 1);
      if (!p.photoGame || (HEADS[s.r.pid] && !HEADS[p.photoGame.r.pid])) p.photoGame = s;
    }
    // greatness = great games + playoff wins, with a championship counting double
    for (const p of byName.values()) p.total = p.great + p.playoffWins + 2 * p.titles;
    const list = [...byName.values()].filter((p) => p.total > 0);
    list.sort((a, b) => b.total - a.total || b.titles - a.titles || b.historic - a.historic || b.sum / b.games - a.sum / a.games);
    return list.slice(0, GOAT_COUNT).map((p, i) => ({ ...p, rank: i + 1, avg: p.sum / p.games, mainTeam: [...p.teams.entries()].sort((x, y) => y[1] - x[1])[0][0] }));
  }
  function goatRow(p) {
    const s = p.photoGame, r = s.r;
    return `<div class="g goat"><span class="rank">#${p.rank}</span>${photo({ r: { ...r, team: p.mainTeam, season: p.last } }, 96, false)}
      <span style="min-width:0"><button type="button" class="nm goat-name" data-player="${esc(p.name)}" style="display:block">${esc(p.name)}</button>
      <span class="sub" style="display:block">${esc(nick(p.mainTeam, p.last))} · ${p.first === p.last ? p.first : `${p.first}–${p.last}`} · ${plural(p.games, "game")} · avg ${one(p.avg)}</span>
      <span class="line" style="display:block">Best: <button type="button" data-id="${esc(r.id === p.best.r.id ? r.id : p.best.r.id)}" style="border-bottom:1px solid currentColor">${one(p.best.score)} ${esc(matchup(p.best.r))}, ${esc(when(p.best.r))}</button></span></span>
      <span class="sc" title="Great games plus playoff wins, championships double">${p.total}<small style="display:block;font-size:10px;color:var(--mute)">${p.great} great · ${p.playoffWins + p.titles} playoff W · ${p.titles} title${p.titles === 1 ? "" : "s"}</small></span></div>`;
  }
  function renderGoats(scored) {
    const goats = buildGoats(scored);
    let limit = GOAT_FIRST;
    const draw = () => {
      $("goatsBody").innerHTML = `<h2>GOATs <span>The ${goats.length} greatest quarterbacks ever</span></h2>
        <p class="meta" style="margin:-16px 0 24px">The big number is great games plus playoff wins, with a championship counting double. A great game rates ${GOAT_BAR} or higher, one of the best of its season. Ties go to titles, then games at ${GOAT_HIGH}+, then career average.</p>
        <div class="list">${goats.slice(0, limit).map(goatRow).join("")}</div>
        ${limit < goats.length ? `<button type="button" class="more" id="moreGoats">Show ${Math.min(50, goats.length - limit)} more</button>` : ""}`;
      const btn = $("moreGoats");
      if (btn) btn.onclick = () => { limit += 50; draw(); };
    };
    draw();
    return goats;
  }
  function renderWorst(scored, N) {
    const worst = scored.slice(-8).reverse();
    $("worstBody").innerHTML = `<h2>Worst of all time <span>The bottom of ${int(N)} games</span></h2>${grid(worst, N)}
      <button type="button" class="btn" id="fullWorst">See the full worst-first list</button>`;
  }
  function row(s) {
    const r = s.r;
    return `<button type="button" class="g" data-id="${esc(r.id)}"><span class="rank">#${int(s.rank)}</span>${photo(s, 96, false)}
      <span style="min-width:0"><span class="nm" style="display:block">${esc(r.player)}</span>
      <span class="sub" style="display:block">${esc(matchup(r))} · ${esc(when(r))}${esc(tagText(r))}</span>
      <span class="line" style="display:block">${esc(statLine(r))}</span></span><span class="sc">${one(s.score)}</span></button>`;
  }

  /* ---------- explanation sheet ---------- */
  const ORD = ["", "1st", "2nd", "3rd", "4th"];
  function values(s) {
    const r = s.r, d = s.d;
    return {
      yds: int(r.yds), td: String(r.td), to: String(d.to), cmp: `${Math.round(d.cmpPct)}%`,
      ypa: one(d.ypa), ry: String(d.ryReal), rtd: String(r.rtd), def: s.defRank ? `#${s.defRank} of ${s.defCount}` : "—",
    };
  }
  const signed = (p) => (p === null || p === undefined ? "n/a" : (p >= 0 ? "+" : "−") + one(Math.abs(p)));
  function openSheet(s, N, actions) {
    const r = s.r, { c1 } = colors(r.team, r.season);
    const allPts = COMPONENTS.map((c) => s.pts[c.key] || 0).concat(s.sit.map((it) => it.pts));
    const maxPts = Math.max(8, ...allPts.map(Math.abs));
    const val = values(s);
    const avgText = (k) => {
      const a = s.avg[k];
      if (a === undefined) return "—";
      if (k === "cmp") return `${Math.round(a)}%`;
      if (k === "yds") return int(a);
      if (k === "ry") return `${Math.round(a)} yds`;
      if (k === "ypa") return one(a);
      return one(a);
    };
    const bar = (p) => {
      if (p === null) return "";
      const w = (Math.abs(p) / maxPts) * 50;
      return p >= 0 ? `<i class="pos" style="width:${w}%;background:${esc(readableOn(c1) === "#000" ? "#000" : c1)}"></i>` : `<i class="neg" style="width:${w}%"></i>`;
    };
    const line = (label, value, avg, p) => `<tr><td>${esc(label)}</td><td class="v">${esc(value)}</td><td class="v avg">${esc(avg)}</td>
      <td style="width:34%;padding-left:14px"><div class="bar">${bar(p)}</div></td><td class="v">${signed(p)}</td></tr>`;
    const statRows = COMPONENTS.map((c) => line(c.label, val[c.key], avgText(c.key), s.pts[c.key])).join("");
    const sitRows = s.sit.map((it) => line(it.label, it.detail, "", it.pts)).join("");
    const poolNote = s.pool === "season" ? `every other game of the ${r.season} season` : s.pool === "decade" ? `games from the ${Math.floor(r.season / 10) * 10}s, because the ${r.season} season is still young` : "every game on record";
    const countNote = !r.verified
      ? ` Play-by-play does not exist for games before 1999, so the full-game check could not be run${r.season < 1994 ? ", and fumbles were not recorded, so turnovers here are interceptions only" : ""}.`
      : r.benched
      ? ` He started and was pulled in the ${ORD[r.exitQ] || "second half"}${r.exitQ ? " quarter" : ""} trailing by ${Math.abs(r.exitM)}, with no injury noted, so it counts.`
      : r.share !== null ? ` He took ${Math.round(r.share * 100)}% of his team's quarterback snaps, so it counts as a full game.` : "";
    const say = explain(s, N);
    const sheet = $("sheet");
    sheet.innerHTML = `<div class="sheet">
      <div class="sheet-top"><span>Why it ranks here</span><button type="button" id="closeSheet">Close</button></div>
      ${photo(s, 960, true)}
      <div class="meta">${esc(when(r))}${r.date ? " · " + esc(fmtDate(r.date)) : ""}</div>
      <div class="name">${esc(r.player)}</div>
      <div>${esc(matchup(r))}${resultText(r) ? " · " + esc(resultText(r)) : ""}</div>
      <div class="meta">${esc(statLine(r))} · ${plural(r.sk, "sack")}</div>
      <div class="scorebar"><div><div class="meta">Score</div><div class="big">${one(s.score)}</div></div>
        <div class="r"><div>#${int(s.rank)} of ${int(N)}</div><div class="meta">${topPct(s, N)} all-time · 50 is average</div></div></div>
      <p class="say">${esc(say[0])}</p><p class="say">${esc(say[1])}</p><p class="say">${esc(say[2])}</p>
      <h3>Where the points came from</h3>
      <div style="overflow-x:auto"><table class="bk"><thead><tr><th>The stats</th><th class="v">This game</th><th class="v avg">${r.season} average</th><th></th><th class="v">Points</th></tr></thead>
      <tbody>${statRows}</tbody>
      ${sitRows ? `<thead><tr><th colspan="5" style="padding-top:26px">The situation</th></tr></thead><tbody>${sitRows}</tbody>` : ""}</table></div>
      <p class="note" style="margin-top:16px">Start at ${one(s.base)}, add the points column, and you get ${one(s.score)}. Solid bars add points. Striped bars take them away.</p>
      <p class="note">Stats are measured against ${esc(poolNote)}.${esc(countNote)}</p>
      <div class="btns"><button type="button" class="btn" id="cmpStart">Compare with another game</button>
      <button type="button" class="btn" id="allBy">All games by ${esc(r.player)}</button></div></div>`;
    $("closeSheet").onclick = () => sheet.close();
    $("allBy").onclick = () => { sheet.close(); actions.showPlayer(r.player); };
    $("cmpStart").onclick = () => { sheet.close(); actions.startCompare(s); };
    if (!sheet.open) sheet.showModal();
    sheet.scrollTop = 0;
  }

  /* ---------- side by side ---------- */
  function openCompare(a, b, N, actions) {
    const va = values(a), vb = values(b);
    const head = (s) => `<div class="side">${photo(s, 480, true)}<div class="meta">${esc(when(s.r))}</div><div class="cname">${esc(s.r.player)}</div>
      <div class="meta">${esc(matchup(s.r))}${resultText(s.r) ? " · " + esc(resultText(s.r)) : ""}</div>
      <div class="cscore">${one(s.score)}</div><div class="meta">#${int(s.rank)} of ${int(N)}</div></div>`;
    const diffs = [];
    const line = (label, ta, pa, tb, pb) => {
      const x = pa || 0, y = pb || 0;
      diffs.push({ label, d: x - y });
      const cls = (mine, other) => (mine > other + 0.05 ? "win" : mine < other - 0.05 ? "lose" : "");
      return `<tr><td class="${cls(x, y)}">${esc(ta)}<small>${signed(pa)}</small></td><th>${esc(label)}</th><td class="${cls(y, x)}">${esc(tb)}<small>${signed(pb)}</small></td></tr>`;
    };
    let rows = COMPONENTS.map((c) => line(c.label, va[c.key], a.pts[c.key], vb[c.key], b.pts[c.key])).join("");
    const sitKeys = [["result", "Result"], ["stakes", "Stakes"], ["comeback", "Comeback"], ["gwd", "Game-winning drive"], ["venue", "Road game"], ["weather", "Weather"], ["missing", "Missing targets"]];
    for (const [key, label] of sitKeys) {
      const ia = a.sit.find((it) => it.key === key), ib = b.sit.find((it) => it.key === key);
      if (!ia && !ib) continue;
      const text = (it) => (!it ? "—" : key === "result" ? `Won ${it.detail}` : key === "gwd" ? "Yes" : key === "venue" ? "Road" : key === "stakes" ? it.label : it.detail);
      rows += line(label, text(ia), ia ? ia.pts : 0, text(ib), ib ? ib.pts : 0);
    }
    const gap = a.score - b.score, lead = gap >= 0 ? a : b, other = gap >= 0 ? b : a;
    diffs.forEach((x) => { x.for = gap >= 0 ? x.d : -x.d; });
    const edges = diffs.filter((x) => x.for >= 1).sort((p, q) => q.for - p.for).slice(0, 3).map((x) => `${x.label.toLowerCase()} (+${one(x.for)})`);
    const verdict = Math.abs(gap) < 0.05 ? "A dead heat." : `${lead.r.player}'s game rates ${one(Math.abs(gap))} points higher than ${other.r.player}'s.` + (edges.length ? ` The biggest edges: ${joinAnd(edges)}.` : "");
    const sheet = $("sheet");
    sheet.innerHTML = `<div class="sheet">
      <div class="sheet-top"><span>Side by side</span><button type="button" id="closeSheet">Close</button></div>
      <div class="sides">${head(a)}${head(b)}</div>
      <p class="say" style="margin-top:26px">${esc(verdict)}</p>
      <table class="cmp"><tbody>${rows}</tbody></table>
      <p class="note" style="margin-top:16px">Small numbers are the points each line added to or took from that game's score. Bold marks the better side.</p>
      <div class="btns"><button type="button" class="btn" id="cmpAgain">Swap in a different second game</button>
      <button type="button" class="btn" id="cmpDone">Done comparing</button></div></div>`;
    $("closeSheet").onclick = () => sheet.close();
    $("cmpAgain").onclick = () => { sheet.close(); $("all").scrollIntoView(); };
    $("cmpDone").onclick = () => { sheet.close(); actions.endCompare(); };
    if (!sheet.open) sheet.showModal();
    sheet.scrollTop = 0;
  }

  /* ---------- start ---------- */
  async function start() {
    const [games, old, players, teams] = await Promise.all([getJson("data/qb_games.json"), getJson("data/qb_games_pre1999.json"), getJson("data/players.json"), getJson("data/teams.json")]);
    if (!games || !games.rows) { $("status").textContent = "Could not load the game data. Try again in a minute."; return; }
    HEADS = (players && players.headshots) || {};
    TEAMS = (teams && teams.teams) || {};
    const rows = buildRows(games).concat(old && old.rows ? buildRows(old) : []);

    const scored = computeModel(rows);
    const N = scored.length;
    const byId = new Map(scored.map((s) => [s.r.id, s]));
    const seasons = [...new Set(scored.map((s) => s.r.season))].sort((a, b) => b - a);
    const latestSeason = seasons[0];
    const latest = { season: latestSeason, week: Math.max(...scored.filter((s) => s.r.season === latestSeason).map((s) => s.r.week)) };
    const latestGame = scored.find((s) => s.r.season === latest.season && s.r.week === latest.week);

    $("status").textContent = `${int(N)} games · ${seasons[seasons.length - 1]}–${latestSeason} · through ${when(latestGame.r)}${games.built ? ` · updated ${fmtDate(games.built)}` : ""}`;
    const shown = renderWeek(scored, N, latest);
    renderRecent(scored, N, latest, shown);
    renderWorst(scored, N);
    renderGoats(scored);

    const state = { q: "", season: "", type: "", order: "best", limit: FIRST_PAGE };
    $("fSeason").innerHTML = `<option value="">All seasons</option>` + seasons.map((y) => `<option value="${y}">${y}</option>`).join("");
    function renderList() {
      let list = scored, from = null;
      const q = state.q.trim().toLowerCase();
      const m = q.match(/^#\s*(\d+)$/);
      if (m) from = +m[1];
      else if (q) { const words = q.split(/\s+/); list = list.filter((s) => words.every((w) => s.hay.includes(w))); }
      if (state.season) list = list.filter((s) => s.r.season === +state.season);
      if (state.type) list = list.filter((s) => s.r.st === state.type);
      if (from) list = list.filter((s) => s.rank >= from);
      if (state.order === "worst") list = list.slice().reverse();
      const page = list.slice(0, state.limit);
      $("shown").textContent = list.length === N ? `${int(N)} games · tap any game to see why it ranks where it does` : `${plural(list.length, "game")} found · rank shown is the all-time rank`;
      $("list").innerHTML = page.length ? page.map(row).join("") : `<p class="empty">No games match. Try a last name, a team or a year.</p>`;
      $("more").hidden = list.length <= state.limit;
    }
    const reset = () => { state.limit = state.q || state.season || state.type || state.order !== "best" ? PAGE : FIRST_PAGE; renderList(); };
    let timer = null;
    $("q").addEventListener("input", (e) => { clearTimeout(timer); timer = setTimeout(() => { state.q = e.target.value; reset(); }, 120); });
    $("fSeason").addEventListener("change", (e) => { state.season = e.target.value; reset(); });
    $("fType").addEventListener("change", (e) => { state.type = e.target.value; reset(); });
    $("fOrder").addEventListener("change", (e) => { state.order = e.target.value; reset(); });
    $("more").addEventListener("click", () => { state.limit += PAGE; renderList(); });
    renderList();

    const setFilters = (q, order) => {
      state.q = q; state.season = ""; state.type = ""; state.order = order;
      $("q").value = q; $("fSeason").value = ""; $("fType").value = ""; $("fOrder").value = order;
      reset();
      $("all").scrollIntoView();
    };
    $("fullWorst").addEventListener("click", () => setFilters("", "worst"));
    document.addEventListener("click", (e) => { const el = e.target.closest("[data-player]"); if (el) setFilters(el.dataset.player, "best"); });

    let compareA = null;
    const bar = $("cmpbar");
    const actions = {
      showPlayer: (name) => setFilters(name, "best"),
      startCompare: (s) => {
        compareA = s;
        $("cmpText").textContent = `Comparing ${s.r.player}, ${when(s.r)}. Now tap any other game.`;
        bar.hidden = false;
        $("all").scrollIntoView();
      },
      endCompare: () => { compareA = null; bar.hidden = true; },
    };
    $("cmpCancel").addEventListener("click", actions.endCompare);
    document.addEventListener("click", (e) => {
      const el = e.target.closest("[data-id]");
      if (!el || !byId.has(el.dataset.id)) return;
      const s = byId.get(el.dataset.id);
      if (compareA && s !== compareA) openCompare(compareA, s, N, actions);
      else openSheet(s, N, actions);
    });
    const sheet = $("sheet");
    sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.close(); });
  }
  start();
})();
