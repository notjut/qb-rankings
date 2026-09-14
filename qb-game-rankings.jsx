import React, { useState, useEffect, useMemo, useRef } from "react";
import Papa from "papaparse";

/* ============================================================
   QB Game Rankings
   Ranks every loaded quarterback game, best to worst, using
   era-adjusted z-scores and a data-derived opponent adjustment.
   ============================================================ */

/* ---------- palette (night game under stadium lights) ---------- */
const C = {
  base: "#0d1b2a",
  surface: "#14263a",
  surface2: "#1c3149",
  line: "#2a4363",
  text: "#eaf0f7",
  muted: "#96a8bf",
  accent: "#f0b44a",
  pos: "#6fd6a8",
  neg: "#f27e6a",
};

const CURRENT_SEASON = (() => { const d = new Date(); return d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1; })();
// Bundled dataset written by build_qb_games.py (served next to index.html when hosted)
const DATA_BASE = "data/";
// Live sources on nflverse (asset names follow the stats_player / espn_data releases; verify there if a fetch 404s)
const LIVE_GAMES_URL = (season) => `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv`;
const LIVE_QBR_URL = "https://github.com/nflverse/nflverse-data/releases/download/espn_data/qbr_week_level.csv";
const MIN_POOL = 60;        // qualifying games a season needs before it gets its own baseline
const SEED_THRESHOLD = 50;  // imported games in a season before seed rows for it are hidden
const PAGE = 50;

const COMPONENTS = [
  { key: "yds", label: "Passing yards", sign: 1 },
  { key: "cmp", label: "Completion %", sign: 1 },
  { key: "td", label: "Passing TDs", sign: 1 },
  { key: "to", label: "Turnovers (INT + fumbles lost)", sign: -1 },
  { key: "eff", label: "QBR (passer rating before 2006)", sign: 1 },
  { key: "rush", label: "Rushing (yards + 20 per TD)", sign: 1 },
  { key: "sk", label: "Sacks taken", sign: -1 },
  { key: "def", label: "Opponent pass defense", sign: 1 },
];
const DEFAULT_WEIGHTS = { yds: 1.0, cmp: 0.6, td: 0.8, to: 1.2, eff: 1.0, rush: 0.5, sk: 0.4, def: 0.7 };
const DEFAULT_SETTINGS = {
  minAtt: 10,
  eraAdjust: true,
  minDefGames: 6,
  qbrMode: "total",
  includePost: true,
  includeSeed: true,
};

/* ---------- small helpers ---------- */
const nz = (a, b) => (a === null || a === undefined ? b : a);
const num = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === "" || s === "NA" || s === "NaN" || s === "null") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const fmtInt = (n) => (n === null || n === undefined ? "—" : Math.round(n).toLocaleString());
const fmt1 = (n) => (n === null || n === undefined ? "—" : (Math.round(n * 10) / 10).toFixed(1));
const fmtZ = (z) => (z === null || z === undefined ? "—" : `${z >= 0 ? "+" : "−"}${Math.abs(z).toFixed(1)}σ`);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(d) {
  if (!d) return null;
  const m = String(d).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return String(d);
  return `${MONTHS[+m[2] - 1] || m[2]} ${+m[3]}, ${m[1]}`;
}
function seasonFromDate(d) {
  const m = String(d).match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return +m[2] <= 3 ? +m[1] - 1 : +m[1];
  const y = String(d).match(/(\d{4})/);
  return y ? +y[1] : null;
}
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
function passerRating(cmp, att, yds, td, int) {
  if (!att) return null;
  const a = clamp((cmp / att - 0.3) * 5, 0, 2.375);
  const b = clamp((yds / att - 3) * 0.25, 0, 2.375);
  const c = clamp((td / att) * 20, 0, 2.375);
  const d = clamp(2.375 - (int / att) * 25, 0, 2.375);
  return ((a + b + c + d) / 6) * 100;
}

/* ---------- teams ---------- */
const NICK = {
  ARI: "Cardinals", PHO: "Cardinals", PHX: "Cardinals", CRD: "Cardinals", ATL: "Falcons", BAL: "Ravens", RAV: "Ravens",
  BUF: "Bills", CAR: "Panthers", CHI: "Bears", CIN: "Bengals", CLE: "Browns", DAL: "Cowboys", DEN: "Broncos",
  DET: "Lions", GB: "Packers", GNB: "Packers", HOU: "Texans", HTX: "Texans", IND: "Colts", CLT: "Colts",
  JAX: "Jaguars", JAC: "Jaguars", KC: "Chiefs", KAN: "Chiefs", LA: "Rams", LAR: "Rams", RAM: "Rams", STL: "Rams",
  LAC: "Chargers", SD: "Chargers", SDG: "Chargers", LV: "Raiders", LVR: "Raiders", OAK: "Raiders", RAI: "Raiders",
  MIA: "Dolphins", MIN: "Vikings", NE: "Patriots", NWE: "Patriots", BOS: "Patriots", NO: "Saints", NOR: "Saints",
  NYG: "Giants", NYJ: "Jets", PHI: "Eagles", PIT: "Steelers", SEA: "Seahawks", SF: "49ers", SFO: "49ers",
  TB: "Buccaneers", TAM: "Buccaneers", TEN: "Titans", OTI: "Titans", WAS: "Commanders", WSH: "Commanders",
  NYY: "Yanks", NYT: "Titans", DTX: "Texans", UNK: "Unknown",
};
const CANON = {
  WSH: "WAS", LAR: "LA", JAC: "JAX", GNB: "GB", KAN: "KC", NWE: "NE", NOR: "NO", SFO: "SF", TAM: "TB", SDG: "SD",
  LVR: "LV", RAI: "OAK", RAM: "LA", OTI: "TEN", CRD: "ARI", CLT: "IND", HTX: "HOU", RAV: "BAL", PHX: "ARI", PHO: "ARI",
};
function normTeam(code, season) {
  let u = String(code || "").toUpperCase().trim();
  if (!u) return "UNK";
  u = CANON[u] || u;
  const s = Number(season) || CURRENT_SEASON;
  if (u === "OAK" && s >= 2020) u = "LV";
  if (u === "LV" && s < 2020) u = "OAK";
  if (u === "LA" && s >= 1995 && s <= 2015) u = "STL";
  if (u === "STL" && s > 2015) u = "LA";
  if (u === "STL" && s >= 1988 && s < 1995) u = "LA";
  if (u === "SD" && s >= 2017) u = "LAC";
  if (u === "LAC" && s >= 1961 && s <= 2016) u = "SD";
  if (u === "TEN" && s <= 1996) u = "HOU";
  if (u === "HOU" && s >= 1997 && s <= 2001) u = "TEN";
  return u;
}
function nick(code, season) {
  const c = String(code || "").toUpperCase();
  const s = Number(season) || CURRENT_SEASON;
  if (c === "HOU" && s <= 1996) return "Oilers";
  if (c === "TEN" && s <= 1998) return "Oilers";
  if (c === "STL" && s <= 1987) return "Cardinals";
  if (c === "BAL" && s <= 1983) return "Colts";
  if (c === "WAS") return s >= 2022 ? "Commanders" : "Washington";
  return NICK[c] || c || "?";
}
function nameKey(name) {
  if (!name) return "";
  const n = String(name).replace(/\./g, " ").replace(/[^A-Za-z' \-]/g, " ").trim();
  const parts = n.split(/\s+/).filter((p) => p && !/^(jr|sr|ii|iii|iv|v)$/i.test(p));
  if (!parts.length) return "";
  const last = parts[parts.length - 1].toLowerCase().replace(/[^a-z]/g, "");
  const first = parts[0][0].toLowerCase();
  return parts.length > 1 ? `${last}|${first}` : last;
}

/* ---------- landmark seed games (verified box scores; sacks, fumbles, rushing not loaded) ---------- */
// player, team, opp, date, season, type, home/away, cmp, att, yds, td, int, result
const SEED = [
  ["Norm Van Brocklin", "LA", "NYY", "1951-09-28", 1951, "REG", "H", 27, 41, 554, 5, 2, "W 54–14"],
  ["Y.A. Tittle", "NYG", "WAS", "1962-10-28", 1962, "REG", "H", 27, 39, 505, 7, 0, "W 49–34"],
  ["Vince Ferragamo", "LA", "CHI", "1982-12-26", 1982, "REG", null, 30, 46, 509, 3, 2, "L 34–26"],
  ["Phil Simms", "NYG", "CIN", "1985-10-13", 1985, "REG", null, 40, 62, 513, 1, 2, "L 35–30"],
  ["Dan Marino", "MIA", "NYJ", "1988-10-23", 1988, "REG", null, 35, 60, 521, 3, 5, "L 44–30"],
  ["Warren Moon", "HOU", "KC", "1990-12-16", 1990, "REG", "A", 27, 45, 527, 3, 0, "W 27–10"],
  ["Boomer Esiason", "ARI", "WAS", "1996-11-10", 1996, "REG", null, 35, 59, 522, 3, 4, "W 37–34 (OT)"],
  ["Elvis Grbac", "KC", "OAK", "2000-11-05", 2000, "REG", null, 39, 53, 504, 2, 2, "L 49–31"],
  ["Drew Brees", "NO", "CIN", "2006-11-19", 2006, "REG", null, 37, 52, 510, 2, 3, "L 31–16"],
  ["Ben Roethlisberger", "PIT", "GB", "2009-12-20", 2009, "REG", "H", 29, 46, 503, 3, 0, "W 37–36"],
  ["Tom Brady", "NE", "MIA", "2011-09-12", 2011, "REG", "A", 32, 48, 517, 4, 1, "W 38–24"],
  ["Matthew Stafford", "DET", "GB", "2012-01-01", 2011, "REG", "A", 36, 59, 520, 5, 2, "L 45–41"],
  ["Eli Manning", "NYG", "TB", "2012-09-16", 2012, "REG", "H", 31, 51, 510, 3, 3, "W 41–34"],
  ["Matt Schaub", "HOU", "JAX", "2012-11-18", 2012, "REG", "H", 43, 55, 527, 5, 2, "W 43–37 (OT)"],
  ["Tony Romo", "DAL", "DEN", "2013-10-06", 2013, "REG", "H", 25, 36, 506, 5, 1, "L 51–48"],
  ["Ben Roethlisberger", "PIT", "IND", "2014-10-26", 2014, "REG", "H", 40, 49, 522, 6, 0, "W 51–34"],
  ["Philip Rivers", "SD", "GB", "2015-10-18", 2015, "REG", "A", 43, 65, 503, 2, 0, "L 27–20"],
  ["Drew Brees", "NO", "NYG", "2015-11-01", 2015, "REG", "H", 39, 50, 505, 7, 2, "W 52–49"],
  ["Matt Ryan", "ATL", "CAR", "2016-10-02", 2016, "REG", "H", 28, 37, 503, 4, 1, "W 48–33"],
  ["Derek Carr", "OAK", "TB", "2016-10-30", 2016, "REG", "A", 40, 59, 513, 4, 0, "W 30–24 (OT)"],
  ["Ben Roethlisberger", "PIT", "BAL", "2017-12-10", 2017, "REG", "H", 44, 66, 506, 2, 0, "W 39–38"],
  ["Tom Brady", "NE", "PHI", "2018-02-04", 2017, "POST", null, 28, 48, 505, 3, 0, "L 41–33"],
  ["Jared Goff", "LA", "TB", "2019-09-29", 2019, "REG", "H", 45, 68, 517, 2, 3, "L 55–40"],
  ["Dak Prescott", "DAL", "CLE", "2020-10-04", 2020, "REG", "H", 41, 58, 502, 4, 1, "L 49–38"],
  ["Ben Roethlisberger", "PIT", "CLE", "2021-01-10", 2020, "POST", "H", 47, 68, 501, 4, 4, "L 48–37"],
  ["Joe Burrow", "CIN", "BAL", "2021-12-26", 2021, "REG", "H", 37, 46, 525, 4, 0, "W 41–21"],
  ["Kirk Cousins", "ATL", "TB", "2024-10-03", 2024, "REG", "H", 42, 58, 509, 4, 1, "W 36–30 (OT)"],
  ["Sid Luckman", "CHI", "NYG", "1943-11-14", 1943, "REG", "A", 21, 32, 433, 7, null, "W 56–7"],
  ["Adrian Burk", "PHI", "WAS", "1954-10-17", 1954, "REG", "A", 19, 27, 232, 7, null, "W 49–21"],
  ["George Blanda", "HOU", "NYT", "1961-11-19", 1961, "REG", "H", 20, 32, 418, 7, null, "W 49–13"],
  ["Joe Kapp", "MIN", "BAL", "1969-09-28", 1969, "REG", "H", 28, 43, 449, 7, null, "W 52–14"],
  ["Peyton Manning", "DEN", "BAL", "2013-09-05", 2013, "REG", "H", 27, 42, 462, 7, 0, "W 49–27"],
  ["Nick Foles", "PHI", "OAK", "2013-11-03", 2013, "REG", "A", 22, 28, 406, 7, 0, "W 49–20"],
];
const SEED_ROWS = SEED.map(([player, team, opp, date, season, st, loc, cmp, att, yds, td, int, res]) => ({
  id: `seed|${season}|${date}|${nameKey(player)}`,
  player, team, opp, season, week: null, st, date, loc, cmp, att, yds, td, int,
  sk: null, skY: null, fl: null, ra: null, ry: null, rtd: null, qbr: null, qbrRaw: null, res, src: "seed",
}));
function withSeeds(rows) {
  const counts = new Map();
  for (const r of rows) counts.set(r.season, (counts.get(r.season) || 0) + 1);
  return rows.concat(SEED_ROWS.filter((s) => (counts.get(s.season) || 0) < SEED_THRESHOLD));
}

/* ---------- persistence (window.storage, per-season keys) ---------- */
const FIELDS = ["id", "player", "team", "opp", "season", "week", "st", "date", "loc", "cmp", "att", "yds", "td", "int", "sk", "skY", "fl", "ra", "ry", "rtd", "qbr", "qbrRaw", "res", "src"];
const store = {
  available: () => typeof window !== "undefined" && window.storage && typeof window.storage.get === "function",
  async get(k) { try { const r = await window.storage.get(k, false); return r ? r.value : null; } catch (e) { return null; } },
  async set(k, v) { try { const r = await window.storage.set(k, v, false); return !!r; } catch (e) { return false; } },
  async del(k) { try { await window.storage.delete(k, false); return true; } catch (e) { return false; } },
  async list(p) { try { const r = await window.storage.list(p, false); return r && r.keys ? r.keys.map((k) => (typeof k === "string" ? k : k.key)) : []; } catch (e) { return []; } },
};
const compact = (list) => ({ v: 1, f: FIELDS, r: list.map((r) => FIELDS.map((k) => nz(r[k], null))) });
function expand(obj) {
  if (!obj || !Array.isArray(obj.r)) return [];
  const f = obj.f || FIELDS;
  return obj.r.map((arr) => { const o = {}; f.forEach((k, i) => { o[k] = nz(arr[i], null); }); return o; });
}
async function persistSeasons(list, seasons) {
  if (!store.available()) return false;
  let ok = true;
  for (const s of seasons) {
    const sub = list.filter((r) => r.season === s);
    const key = `qbdb:s:${s}`;
    if (sub.length) ok = (await store.set(key, JSON.stringify(compact(sub)))) && ok;
    else await store.del(key);
  }
  return ok;
}

/* ---------- scoring model ---------- */
function derive(r) {
  const att = r.att || 0;
  const cmpPct = att > 0 && r.cmp != null ? (r.cmp / att) * 100 : null;
  const to = r.int == null && r.fl == null ? null : (r.int || 0) + (r.fl || 0);
  const rush = r.ry == null && r.rtd == null ? null : (r.ry || 0) + 20 * (r.rtd || 0);
  const rating = att > 0 && r.int != null ? passerRating(r.cmp || 0, att, r.yds || 0, r.td || 0, r.int) : null;
  const sk = r.sk == null ? null : r.sk;
  const den = att + (r.sk || 0);
  const any = den > 0 && r.int != null ? ((r.yds || 0) + 20 * (r.td || 0) - 45 * r.int - (r.skY || 0)) / den : null;
  return { cmpPct, to, rush, rating, sk, any };
}
const qbrOf = (r, settings) => (settings.qbrMode === "raw" ? nz(r.qbrRaw, nz(r.qbr, null)) : nz(r.qbr, nz(r.qbrRaw, null)));
function accAdd(acc, key, v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return;
  const a = acc[key] || (acc[key] = { n: 0, s: 0, ss: 0 });
  a.n += 1; a.s += v; a.ss += v * v;
}
function accStats(a, pool) {
  if (!a || a.n < 2) return null;
  const m = a.s / a.n;
  const sd = Math.sqrt(Math.max(a.ss / a.n - m * m, 0));
  return { m, sd, n: a.n, pool };
}
const STAT_KEYS = ["yds", "cmpPct", "td", "to", "rating", "qbr", "rush", "sk"];

function computeModel(rows, weights, settings) {
  const qual = (r) => (r.att || 0) >= settings.minAtt && (settings.includePost || r.st !== "POST");
  const derived = rows.map(derive);
  const seasonAcc = new Map();
  const decadeAcc = new Map();
  const globalAcc = {};
  const defBySeason = new Map();

  rows.forEach((r, i) => {
    if (!qual(r)) return;
    const d = derived[i];
    const vals = { yds: r.yds, cmpPct: d.cmpPct, td: r.td, to: d.to, rating: d.rating, qbr: qbrOf(r, settings), rush: d.rush, sk: d.sk };
    let sAcc = seasonAcc.get(r.season); if (!sAcc) { sAcc = {}; seasonAcc.set(r.season, sAcc); }
    const dec = Math.floor(r.season / 10) * 10;
    let dAcc = decadeAcc.get(dec); if (!dAcc) { dAcc = {}; decadeAcc.set(dec, dAcc); }
    for (const k of STAT_KEYS) { accAdd(sAcc, k, vals[k]); accAdd(dAcc, k, vals[k]); accAdd(globalAcc, k, vals[k]); }
    if (d.any != null) {
      let ds = defBySeason.get(r.season); if (!ds) { ds = { n: 0, s: 0, teams: new Map() }; defBySeason.set(r.season, ds); }
      ds.n += 1; ds.s += d.any;
      let t = ds.teams.get(r.opp); if (!t) { t = { n: 0, s: 0 }; ds.teams.set(r.opp, t); }
      t.n += 1; t.s += d.any;
    }
  });

  const defInfo = new Map();
  for (const [season, ds] of defBySeason) {
    const mean = ds.s / ds.n;
    const teams = [...ds.teams.entries()]
      .map(([code, t]) => ({ code, n: t.n, allowed: t.s / t.n }))
      .filter((t) => t.n >= settings.minDefGames)
      .sort((a, b) => a.allowed - b.allowed);
    const rankMap = new Map(teams.map((t, i) => [t.code, i + 1]));
    const diffs = teams.map((t) => mean - t.allowed);
    let sd = null;
    if (diffs.length >= 2) {
      const dm = diffs.reduce((a, x) => a + x, 0) / diffs.length;
      sd = Math.sqrt(Math.max(diffs.reduce((a, x) => a + (x - dm) * (x - dm), 0) / diffs.length, 0));
      if (sd < 1e-6) sd = null;
    }
    defInfo.set(season, { mean, sd, rankMap, count: teams.length, teams: ds.teams });
  }

  const pick = (a, pool) => { const st = accStats(a, pool); return st && st.n >= MIN_POOL ? st : null; };
  const baseCache = new Map();
  const getBase = (season, key) => {
    const ck = `${season}|${key}`;
    if (baseCache.has(ck)) return baseCache.get(ck);
    let b;
    if (settings.eraAdjust) {
      b = pick((seasonAcc.get(season) || {})[key], "season")
        || pick((decadeAcc.get(Math.floor(season / 10) * 10) || {})[key], "decade")
        || accStats(globalAcc[key], "all loaded games");
    } else b = accStats(globalAcc[key], "all loaded games");
    baseCache.set(ck, b || null);
    return b || null;
  };

  const scored = [];
  rows.forEach((r, i) => {
    if (!qual(r)) return;
    const d = derived[i];
    const z = {};
    let poolUsed = null;
    const zval = (key, v) => {
      if (v === null || v === undefined) return null;
      const b = getBase(r.season, key);
      if (!b || !b.sd) return null;
      if (!poolUsed) poolUsed = b;
      return (v - b.m) / b.sd;
    };
    z.yds = zval("yds", r.yds);
    z.cmp = zval("cmpPct", d.cmpPct);
    z.td = zval("td", r.td);
    z.to = zval("to", d.to);
    const q = qbrOf(r, settings);
    let effSrc = "qbr";
    z.eff = q != null ? zval("qbr", q) : null;
    if (z.eff == null) { z.eff = zval("rating", d.rating); effSrc = "rating"; }
    z.rush = zval("rush", d.rush);
    z.sk = zval("sk", d.sk);
    let defZ = null, defRank = null, defCount = null;
    const di = defInfo.get(r.season);
    if (di && d.any != null) {
      const t = di.teams.get(r.opp);
      if (t && t.n - 1 >= settings.minDefGames && di.sd) {
        const loo = (t.s - d.any) / (t.n - 1);
        defZ = (di.mean - loo) / di.sd;
      }
      defRank = di.rankMap.get(r.opp) || null;
      defCount = di.count;
    }
    z.def = defZ;
    let sum = 0, wsq = 0;
    const missing = [];
    for (const c of COMPONENTS) {
      const w = weights[c.key] || 0;
      wsq += w * w;
      if (z[c.key] === null || z[c.key] === undefined) { if (w) missing.push(c.key); continue; }
      sum += c.sign * w * z[c.key];
    }
    const S = wsq ? sum / Math.sqrt(wsq) : 0;
    const hay = `${r.player} ${r.team} ${nick(r.team, r.season)} ${r.opp} ${nick(r.opp, r.season)} ${r.season} ${r.st === "POST" ? "playoffs post" : "regular"}`.toLowerCase();
    scored.push({ r, d, z, S, score: 50 + 10 * S, missing, effSrc, q, defRank, defCount, pool: poolUsed, hay });
  });
  scored.sort((a, b) => b.score - a.score || (b.r.yds || 0) - (a.r.yds || 0));
  const N = scored.length;
  scored.forEach((s, i) => { s.rank = i + 1; s.worst = N - i; });
  const seasons = [...seasonAcc.keys()].sort((a, b) => a - b);
  const fullSeasons = seasons.filter((s) => (seasonAcc.get(s).yds || { n: 0 }).n >= MIN_POOL).length;
  return { scored, N, seasons, fullSeasons };
}

/* ---------- CSV parsing ---------- */
function cleanHeader(h) { return String(nz(h, "")).replace(/^\ufeff/, "").trim(); }
function dedupeHeaders(row) {
  const seen = new Map();
  return (row || []).map((h) => {
    const base = cleanHeader(h) || "column";
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} (${n})`;
  });
}
function detectKind(headers) {
  const H = headers.map((h) => h.toLowerCase());
  if (H.includes("qbr_total") && H.includes("game_week")) return "qbr";
  if (H.includes("passing_yards") && H.includes("attempts") && (H.includes("player_display_name") || H.includes("player_name"))) return "nflverse";
  return "generic";
}
function parseCsvInput(input, onDone, onError) {
  let headers = null, kind = null, iAtt = null, iPos = null;
  const rows = [];
  Papa.parse(input, {
    skipEmptyLines: true,
    step: (res) => {
      const row = res.data;
      if (!headers) {
        headers = row.map(cleanHeader);
        kind = detectKind(headers);
        if (kind === "nflverse") {
          const H = headers.map((h) => h.toLowerCase());
          iAtt = H.indexOf("attempts");
          iPos = H.indexOf("position");
        }
        if (kind === "generic") rows.push(row);
        return;
      }
      if (kind === "nflverse") {
        const att = Number(row[iAtt]);
        if (!(att > 0)) return;
        const pos = iPos >= 0 ? String(nz(row[iPos], "")).toUpperCase() : "";
        if (pos && pos !== "QB") return;
      }
      rows.push(row);
    },
    complete: () => onDone({ headers: headers || [], rows, kind: kind || "generic" }),
    error: (e) => onError(e),
  });
}
function buildNflverse(headers, raw) {
  const H = headers.map((h) => h.toLowerCase());
  const find = (names) => { for (const n of names) { const i = H.indexOf(n); if (i >= 0) return i; } return null; };
  const I = {
    player: find(["player_display_name", "player_name"]), team: find(["team", "recent_team"]), opp: find(["opponent_team"]),
    season: find(["season"]), week: find(["week"]), st: find(["season_type"]), cmp: find(["completions"]), att: find(["attempts"]),
    yds: find(["passing_yards"]), td: find(["passing_tds"]), int: find(["passing_interceptions", "interceptions"]),
    sk: find(["sacks_suffered", "sacks"]), skY: find(["sack_yards_lost", "sack_yards"]), sfl: find(["sack_fumbles_lost"]),
    rfl: find(["rushing_fumbles_lost"]), cfl: find(["receiving_fumbles_lost"]), ra: find(["carries"]), ry: find(["rushing_yards"]), rtd: find(["rushing_tds"]),
  };
  const g = (row, i) => (i === null || i === undefined ? null : row[i]);
  const out = [];
  for (const row of raw) {
    const season = num(g(row, I.season));
    const att = num(g(row, I.att)) || 0;
    if (!season || att <= 0) continue;
    const player = String(nz(g(row, I.player), "")).trim();
    if (!player) continue;
    const st = String(nz(g(row, I.st), "REG")).toUpperCase().startsWith("POST") ? "POST" : "REG";
    const team = normTeam(g(row, I.team), season);
    const opp = normTeam(g(row, I.opp), season);
    const week = num(g(row, I.week));
    const flParts = [g(row, I.sfl), g(row, I.rfl), g(row, I.cfl)].map(num).filter((v) => v !== null);
    const fl = flParts.length ? flParts.reduce((a, b) => a + b, 0) : null;
    out.push({
      id: `${season}|${st}|${week}|${team}|${nameKey(player)}`, player, team, opp, season, week, st, date: null, loc: null,
      cmp: num(g(row, I.cmp)) || 0, att, yds: num(g(row, I.yds)) || 0, td: num(g(row, I.td)) || 0, int: num(g(row, I.int)) || 0,
      sk: I.sk === null ? null : num(g(row, I.sk)) || 0, skY: I.skY === null ? null : num(g(row, I.skY)) || 0, fl,
      ra: I.ra === null ? null : num(g(row, I.ra)) || 0, ry: I.ry === null ? null : num(g(row, I.ry)) || 0, rtd: I.rtd === null ? null : num(g(row, I.rtd)) || 0,
      qbr: null, qbrRaw: null, res: null, src: "nflverse",
    });
  }
  return out;
}
const TARGETS = [
  ["player", "Player name", ["player_display_name", "player_name", "player", "name", "qb", "quarterback", "passer"]],
  ["team", "Team", ["team", "recent_team", "tm", "posteam"]],
  ["opp", "Opponent", ["opponent_team", "opp", "opponent", "defteam"]],
  ["season", "Season", ["season", "year", "yr"]],
  ["week", "Week", ["week", "wk", "game_week"]],
  ["st", "Season type", ["season_type", "game_type", "type", "playoffs"]],
  ["date", "Date", ["date", "game_date", "gameday"]],
  ["loc", "Home/away marker", ["loc", "location", "home", "@", "site"]],
  ["cmp", "Completions", ["cmp", "completions", "comp", "pass_cmp"]],
  ["att", "Pass attempts", ["att", "attempts", "pass_att", "passatt"]],
  ["yds", "Passing yards", ["yds", "passing_yards", "pass_yds", "yards", "passyds"]],
  ["td", "Passing TD", ["td", "passing_tds", "pass_td", "tds"]],
  ["int", "Interceptions", ["int", "interceptions", "ints", "pass_int", "passing_interceptions"]],
  ["sk", "Sacks taken", ["sk", "sacks", "sacks_suffered", "sacked", "sack"]],
  ["skY", "Sack yards lost", ["sack_yards", "sack_yards_lost", "sk yds", "skyds", "yds lost"]],
  ["fl", "Fumbles lost", ["fl", "fumbles_lost", "fum_lost", "fumbles lost"]],
  ["ra", "Rush attempts", ["carries", "rush_att", "rushing_attempts", "rush att", "ra"]],
  ["ry", "Rush yards", ["rushing_yards", "rush_yds", "rush yds", "ry"]],
  ["rtd", "Rush TD", ["rushing_tds", "rush_td", "rush td", "rtd"]],
  ["qbr", "QBR", ["qbr", "qbr_total", "total_qbr"]],
  ["res", "Result", ["result", "w/l", "wl"]],
];
function guessMapping(headers) {
  const m = {};
  const lower = headers.map((h) => h.toLowerCase());
  for (const [key, , aliases] of TARGETS) {
    let hit = null;
    for (const a of aliases) { const i = lower.indexOf(a); if (i >= 0) { hit = headers[i]; break; } }
    m[key] = hit || "";
  }
  return m;
}
function buildGeneric(headers, dataRows, mapping, fallbackPlayer) {
  const I = {};
  for (const [k] of TARGETS) { const h = mapping[k]; const i = h ? headers.indexOf(h) : -1; I[k] = i < 0 ? null : i; }
  const g = (row, k) => (I[k] === null ? null : row[I[k]]);
  const out = [];
  let skipped = 0;
  for (const row of dataRows) {
    const player = String(nz(g(row, "player"), "") || fallbackPlayer || "").trim();
    const date = g(row, "date") ? String(g(row, "date")).trim() : null;
    let season = num(g(row, "season"));
    if (!season && date) season = seasonFromDate(date);
    const att = num(g(row, "att"));
    const yds = num(g(row, "yds"));
    if (!player || !season || att === null || yds === null) { skipped += 1; continue; }
    const stRaw = String(nz(g(row, "st"), "")).toUpperCase();
    const st = stRaw.startsWith("POST") || stRaw.startsWith("PLAY") || stRaw === "P" ? "POST" : "REG";
    const team = normTeam(nz(g(row, "team"), "UNK"), season);
    const opp = normTeam(nz(g(row, "opp"), "UNK"), season);
    const locRaw = String(nz(g(row, "loc"), "")).trim().toLowerCase();
    const loc = locRaw === "@" || locRaw === "a" || locRaw === "away" ? "A" : locRaw === "h" || locRaw === "home" || locRaw === "vs" ? "H" : null;
    const week = num(g(row, "week"));
    const idPart = week !== null ? week : date || "x";
    out.push({
      id: `${season}|${st}|${idPart}|${team}|${nameKey(player)}`, player, team, opp, season, week, st, date, loc,
      cmp: num(g(row, "cmp")) || 0, att, yds, td: num(g(row, "td")) || 0,
      int: I.int === null ? null : num(g(row, "int")) || 0, sk: I.sk === null ? null : num(g(row, "sk")) || 0,
      skY: I.skY === null ? null : num(g(row, "skY")) || 0, fl: I.fl === null ? null : num(g(row, "fl")) || 0,
      ra: I.ra === null ? null : num(g(row, "ra")) || 0, ry: I.ry === null ? null : num(g(row, "ry")) || 0, rtd: I.rtd === null ? null : num(g(row, "rtd")) || 0,
      qbr: I.qbr === null ? null : num(g(row, "qbr")), qbrRaw: null, res: g(row, "res") ? String(g(row, "res")) : null, src: "csv",
    });
  }
  return { out, skipped };
}
function matchQbr(rows, headers, raw) {
  const H = headers.map((h) => h.toLowerCase());
  const ix = (n) => { const i = H.indexOf(n); return i < 0 ? null : i; };
  const iSeason = ix("season"), iType = ix("season_type"), iWeek = ix("game_week"), iTeam = ix("team_abb"), iShort = ix("name_short"),
    iDisp = ix("name_display"), iFirst = ix("name_first"), iLast = ix("name_last"), iTot = ix("qbr_total"), iRaw = ix("qbr_raw");
  const byKey = new Map();
  for (const r of rows) {
    const nk = nameKey(r.player);
    const t = normTeam(r.team, r.season);
    if (r.st === "POST") { const k = `${r.season}|POST|${t}|${nk}`; let l = byKey.get(k); if (!l) { l = []; byKey.set(k, l); } l.push(r); }
    else byKey.set(`${r.season}|REG|${r.week}|${t}|${nk}`, r);
  }
  for (const v of byKey.values()) if (Array.isArray(v)) v.sort((a, b) => (a.week || 0) - (b.week || 0));
  const updates = new Map();
  const postQ = new Map();
  let matched = 0;
  for (const row of raw) {
    const season = num(row[iSeason]);
    const qt = iTot === null ? null : num(row[iTot]);
    if (!season || qt === null) continue;
    const typeRaw = String(nz(row[iType], "")).toUpperCase();
    const isPost = typeRaw.startsWith("POST") || typeRaw.startsWith("PLAY");
    const team = normTeam(iTeam === null ? "" : row[iTeam], season);
    const name = iDisp !== null && row[iDisp] ? row[iDisp] : iFirst !== null && iLast !== null ? `${row[iFirst]} ${row[iLast]}` : iShort !== null ? row[iShort] : "";
    const nk = nameKey(name);
    const qr = iRaw === null ? null : num(row[iRaw]);
    if (isPost) { const k = `${season}|POST|${team}|${nk}`; let l = postQ.get(k); if (!l) { l = []; postQ.set(k, l); } l.push({ w: num(row[iWeek]) || 0, qt, qr }); }
    else {
      const r = byKey.get(`${season}|REG|${num(row[iWeek])}|${team}|${nk}`);
      if (r && !Array.isArray(r)) { updates.set(r.id, { qbr: qt, qbrRaw: qr }); matched += 1; }
    }
  }
  for (const [k, list] of postQ) {
    const ours = byKey.get(k);
    if (!ours || !Array.isArray(ours)) continue;
    list.sort((a, b) => a.w - b.w);
    list.forEach((q, i) => { const r = ours[i]; if (r) { updates.set(r.id, { qbr: q.qt, qbrRaw: q.qr }); matched += 1; } });
  }
  return { updates, matched, total: raw.length };
}
function mergeRows(existing, incoming) {
  const map = new Map(existing.map((r) => [r.id, r]));
  for (const r of incoming) {
    const old = map.get(r.id);
    if (old && r.qbr === null && old.qbr !== null) map.set(r.id, { ...r, qbr: old.qbr, qbrRaw: old.qbrRaw });
    else map.set(r.id, r);
  }
  return [...map.values()];
}
async function fetchJson(path) {
  try {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) { return null; }
}
async function fetchText(url) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.text();
  } catch (e) { return null; }
}
function latestWeek(rows) {
  let best = null;
  for (const r of rows) {
    if (r.week === null || r.week === undefined) continue;
    if (!best || r.season > best.season || (r.season === best.season && r.week > best.week)) best = { season: r.season, week: r.week, st: r.st };
  }
  return best ? `${best.season} Week ${best.week}${best.st === "POST" ? " (playoffs)" : ""}` : null;
}
function applyQbrRows(rows, headers, raw) {
  const { updates, matched } = matchQbr(rows, headers, raw);
  return { rows: rows.map((r) => (updates.has(r.id) ? { ...r, ...updates.get(r.id) } : r)), matched, seasons: [...new Set(rows.filter((r) => updates.has(r.id)).map((r) => r.season))] };
}

/* ---------- UI primitives ---------- */
const btnBase = "rounded-lg px-3 py-2 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:opacity-40";
function Button({ children, onClick, tone = "ghost", disabled, className = "" }) {
  const styles = tone === "primary"
    ? { background: C.accent, color: "#1a1206" }
    : tone === "danger"
      ? { background: "transparent", color: C.neg, border: `1px solid ${C.neg}` }
      : { background: C.surface2, color: C.text, border: `1px solid ${C.line}` };
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`${btnBase} ${className}`} style={styles}>
      {children}
    </button>
  );
}
const inputCls = "w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300";
const inputStyle = { background: C.base, color: C.text, border: `1px solid ${C.line}` };
function Field({ label, children }) {
  return (
    <label className="block text-xs" style={{ color: C.muted }}>
      <span className="block mb-1">{label}</span>
      {children}
    </label>
  );
}
function Panel({ title, children, note }) {
  return (
    <section className="rounded-xl p-4 mb-4" style={{ background: C.surface, border: `1px solid ${C.line}` }}>
      <h2 className="text-base font-bold mb-1" style={{ color: C.text }}>{title}</h2>
      {note && <p className="text-xs mb-3" style={{ color: C.muted }}>{note}</p>}
      {children}
    </section>
  );
}
function Toggle({ label, checked, onChange, hint }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <div>
        <div className="text-sm" style={{ color: C.text }}>{label}</div>
        {hint && <div className="text-xs" style={{ color: C.muted }}>{hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className="relative h-6 w-11 shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
        style={{ background: checked ? C.accent : C.line }}
      >
        <span className="absolute top-0.5 h-5 w-5 rounded-full bg-white" style={{ left: checked ? 22 : 2 }} />
      </button>
    </div>
  );
}

/* ---------- ranking row ---------- */
function StatStrip({ r }) {
  const parts = [`${fmtInt(r.cmp)}/${fmtInt(r.att)}`, `${fmtInt(r.yds)} yds`, `${fmtInt(r.td)} TD`, r.int === null ? "INT n/a" : `${r.int} INT`];
  if (r.sk !== null && r.sk !== undefined) parts.push(`${r.sk} sk`);
  if (r.ry !== null && r.ry !== undefined) parts.push(`${r.ry} rush${r.rtd ? ` +${r.rtd} TD` : ""}`);
  return <div className="text-xs tabular-nums" style={{ color: C.muted }}>{parts.join(", ")}</div>;
}
function matchupLine(r) {
  const vs = r.loc === "A" ? "at" : "vs";
  const when = r.week !== null && r.week !== undefined ? `${r.season} Week ${r.week}${r.st === "POST" ? " (playoffs)" : ""}` : fmtDate(r.date) || `${r.season}`;
  return `${vs} ${nick(r.opp, r.season)}, ${when}`;
}
function RankRow({ s, open, onToggle, weights, showWorst }) {
  const { r, z } = s;
  const contribs = COMPONENTS.map((c) => ({ ...c, z: z[c.key], v: z[c.key] === null || z[c.key] === undefined ? null : c.sign * (weights[c.key] || 0) * z[c.key] }));
  const maxAbs = Math.max(0.5, ...contribs.map((c) => (c.v === null ? 0 : Math.abs(c.v))));
  const srcLabel = { nflverse: "nflverse import", csv: "CSV import", manual: "entered by hand", seed: "landmark seed game" }[r.src] || r.src;
  return (
    <li style={{ borderBottom: `1px solid ${C.line}` }}>
      <button type="button" onClick={onToggle} className="w-full text-left px-4 py-3 flex items-start gap-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300" aria-expanded={open}>
        <div className="w-16 shrink-0">
          <div className="text-lg font-black tabular-nums leading-tight" style={{ color: C.accent }}>#{s.rank.toLocaleString()}</div>
          {showWorst && <div className="text-xs tabular-nums" style={{ color: C.muted }}>worst #{s.worst.toLocaleString()}</div>}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold truncate" style={{ color: C.text }}>{r.player} <span className="font-normal text-xs" style={{ color: C.muted }}>{r.team}</span></div>
          <div className="text-sm" style={{ color: C.muted }}>{matchupLine(r)}</div>
          <StatStrip r={r} />
        </div>
        <div className="text-right shrink-0">
          <div className="text-lg font-bold tabular-nums" style={{ color: s.S >= 0 ? C.pos : C.neg }}>{fmt1(s.score)}</div>
          <div className="text-xs" style={{ color: C.muted }}>{fmtZ(s.S)}</div>
        </div>
      </button>
      {open && (
        <div className="px-4 pb-4 text-sm" style={{ color: C.text }}>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 tabular-nums mb-3">
            <div>Completions <b>{fmtInt(r.cmp)}/{fmtInt(r.att)}</b> ({fmt1(s.d.cmpPct)}%)</div>
            <div>Passing yards <b>{fmtInt(r.yds)}</b></div>
            <div>TD / INT <b>{fmtInt(r.td)} / {r.int === null ? "n/a" : r.int}</b></div>
            <div>Passer rating <b>{fmt1(s.d.rating)}</b></div>
            <div>QBR <b>{s.q === null || s.q === undefined ? "n/a" : fmt1(s.q)}</b></div>
            <div>Sacks <b>{r.sk === null ? "n/a" : `${r.sk} for ${fmtInt(r.skY || 0)}`}</b></div>
            <div>Fumbles lost <b>{r.fl === null ? "n/a" : r.fl}</b></div>
            <div>Rushing <b>{r.ry === null ? "n/a" : `${fmtInt(r.ra || 0)} for ${fmtInt(r.ry)}, ${fmtInt(r.rtd || 0)} TD`}</b></div>
            <div className="col-span-2">
              {nick(r.opp, r.season)} pass defense: <b>{s.defRank ? `#${s.defRank} of ${s.defCount} that season` : "not enough games loaded to rate"}</b>
            </div>
            {r.res && <div className="col-span-2">Result <b>{r.res}</b></div>}
          </div>
          <div className="space-y-1.5 mb-3">
            {contribs.map((c) => (
              <div key={c.key} className="flex items-center gap-2 text-xs">
                <div className="w-36 shrink-0 truncate" style={{ color: C.muted }}>{c.label.replace(/ \(.*\)/, "")}</div>
                <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: C.base }}>
                  {c.v !== null && (
                    <div className="h-full rounded-full" style={{ width: `${clamp((Math.abs(c.v) / maxAbs) * 100, 3, 100)}%`, background: c.v >= 0 ? C.pos : C.neg }} />
                  )}
                </div>
                <div className="w-14 text-right tabular-nums" style={{ color: c.v === null ? C.muted : c.v >= 0 ? C.pos : C.neg }}>
                  {c.v === null ? "n/a" : `${c.v >= 0 ? "+" : "−"}${Math.abs(c.v).toFixed(2)}`}
                </div>
              </div>
            ))}
          </div>
          <div className="text-xs" style={{ color: C.muted }}>
            {s.effSrc === "rating" ? "Passer rating used in place of QBR. " : ""}
            {s.pool ? `Baseline: ${s.pool.pool === "season" ? `${r.season} season` : s.pool.pool} (${s.pool.n.toLocaleString()} games). ` : ""}
            {s.missing.length ? `Not loaded for this game: ${s.missing.map((k) => COMPONENTS.find((c) => c.key === k).label.split(" (")[0].toLowerCase()).join(", ")}. ` : ""}
            Source: {srcLabel}.
          </div>
        </div>
      )}
    </li>
  );
}

/* ============================================================ */
export default function QBGameRankings() {
  const [rows, setRows] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [weights, setWeights] = useState(DEFAULT_WEIGHTS);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [tab, setTab] = useState("rank");
  const [search, setSearch] = useState("");
  const [dir, setDir] = useState("best");
  const [stFilter, setStFilter] = useState("ALL");
  const [seasonMin, setSeasonMin] = useState("");
  const [seasonMax, setSeasonMax] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);
  const [notice, setNotice] = useState(null);
  const [importing, setImporting] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [bundle, setBundle] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [form, setForm] = useState({ player: "", team: "", opp: "", season: String(CURRENT_SEASON), week: "", st: "REG", loc: "H", cmp: "", att: "", yds: "", td: "", int: "", sk: "", skY: "", fl: "", ra: "", ry: "", rtd: "", qbr: "" });
  const fileRef = useRef(null);
  const rowsRef = useRef(rows);
  useEffect(() => { rowsRef.current = rows; }, [rows]);

  /* load saved data, then the bundled dataset if this copy is hosted with one */
  useEffect(() => {
    let alive = true;
    (async () => {
      let all = [];
      if (store.available()) {
        const raw = await store.get("qbdb:settings");
        if (raw) { try { const o = JSON.parse(raw); if (o.weights) setWeights({ ...DEFAULT_WEIGHTS, ...o.weights }); if (o.settings) setSettings({ ...DEFAULT_SETTINGS, ...o.settings }); } catch (e) { /* ignore */ } }
        const keys = await store.list("qbdb:s:");
        for (const k of keys) {
          const v = await store.get(k);
          if (!v) continue;
          try { all = all.concat(expand(JSON.parse(v))); } catch (e) { /* skip bad key */ }
        }
      }
      const games = await fetchJson(DATA_BASE + "qb_games.json");
      if (games && Array.isArray(games.headers) && Array.isArray(games.rows)) {
        const built = buildNflverse(games.headers, games.rows);
        all = mergeRows(all, built);
        const qbr = await fetchJson(DATA_BASE + "qbr.json");
        if (qbr && Array.isArray(qbr.headers) && Array.isArray(qbr.rows)) all = applyQbrRows(all, qbr.headers, qbr.rows).rows;
        if (alive) setBundle({ built: games.built || null, games: built.length, through: latestWeek(built) });
      }
      if (alive) { setRows(all); setLoaded(true); }
    })();
    return () => { alive = false; };
  }, []);

  /* save settings */
  useEffect(() => {
    if (!loaded || !store.available()) return;
    const t = setTimeout(() => { store.set("qbdb:settings", JSON.stringify({ weights, settings })); }, 400);
    return () => clearTimeout(t);
  }, [weights, settings, loaded]);

  const allRows = useMemo(() => (settings.includeSeed ? withSeeds(rows) : rows), [rows, settings.includeSeed]);
  const model = useMemo(() => computeModel(allRows, weights, settings), [allRows, weights, settings]);

  const seasonsAvailable = model.seasons;
  const visible = useMemo(() => {
    let list = model.scored;
    if (stFilter !== "ALL") list = list.filter((s) => s.r.st === stFilter);
    const mn = num(seasonMin), mx = num(seasonMax);
    if (mn !== null) list = list.filter((s) => s.r.season >= mn);
    if (mx !== null) list = list.filter((s) => s.r.season <= mx);
    const q = search.trim().toLowerCase();
    if (q.startsWith("#")) {
      const n = parseInt(q.slice(1).replace(/,/g, ""), 10);
      if (n) list = list.filter((s) => s.rank === n);
    } else if (q) {
      const toks = q.split(/\s+/);
      list = list.filter((s) => toks.every((t) => s.hay.includes(t)));
    }
    if (dir === "worst") list = [...list].reverse();
    return list;
  }, [model, stFilter, seasonMin, seasonMax, search, dir]);
  useEffect(() => { setPage(1); }, [search, dir, stFilter, seasonMin, seasonMax]);

  const coverage = useMemo(() => {
    const m = new Map();
    for (const r of allRows) {
      let c = m.get(r.season);
      if (!c) { c = { season: r.season, n: 0, sk: 0, fl: 0, qbr: 0, src: new Set() }; m.set(r.season, c); }
      c.n += 1; if (r.sk !== null) c.sk += 1; if (r.fl !== null) c.fl += 1; if (r.qbr !== null || r.qbrRaw !== null) c.qbr += 1; c.src.add(r.src);
    }
    return [...m.values()].sort((a, b) => b.season - a.season);
  }, [allRows]);

  function say(text, kind = "ok") { setNotice({ text, kind }); }

  async function commitRows(incoming, label) {
    if (!incoming.length) { say(`No quarterback games found in ${label}.`, "err"); return; }
    const next = mergeRows(rowsRef.current, incoming);
    setRows(next);
    const seasons = [...new Set(incoming.map((r) => r.season))];
    const saved = await persistSeasons(next, seasons);
    const span = seasons.length === 1 ? String(seasons[0]) : `${Math.min(...seasons)}–${Math.max(...seasons)}`;
    say(`Loaded ${incoming.length.toLocaleString()} games (${span}) from ${label}.${store.available() ? (saved ? " Saved on this device." : " Could not save to this device.") : ""}`);
  }
  function onFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    e.target.value = "";
    setImporting({ stage: "parsing", name: file.name });
    parseCsvInput(
      file,
      async (res) => {
        if (res.kind === "nflverse") {
          await commitRows(buildNflverse(res.headers, res.rows), file.name);
          setImporting(null);
        } else if (res.kind === "qbr") {
          const { updates, matched, total } = matchQbr(rowsRef.current, res.headers, res.rows);
          if (!matched) { say(`No matches: load the passing stats for those seasons first, then load ${file.name} again.`, "err"); setImporting(null); return; }
          const next = rowsRef.current.map((r) => (updates.has(r.id) ? { ...r, ...updates.get(r.id) } : r));
          setRows(next);
          const seasons = [...new Set(next.filter((r) => updates.has(r.id)).map((r) => r.season))];
          await persistSeasons(next, seasons);
          say(`Attached QBR to ${matched.toLocaleString()} of ${total.toLocaleString()} QBR rows in ${file.name}.`);
          setImporting(null);
        } else {
          if (!res.rows.length) { say(`${file.name} is empty.`, "err"); setImporting(null); return; }
          const headers = dedupeHeaders(res.rows[0]);
          setImporting({ stage: "map", name: file.name, raw: res.rows, headerRow: 0, headers, mapping: guessMapping(headers), fallbackPlayer: "" });
        }
      },
      (err) => { setImporting(null); say(`Could not read ${file.name}: ${err && err.message ? err.message : err}`, "err"); },
    );
  }
  function setHeaderRow(i) {
    const headers = dedupeHeaders(importing.raw[i]);
    setImporting({ ...importing, headerRow: i, headers, mapping: guessMapping(headers) });
  }
  async function finishGeneric() {
    const { headers, raw, headerRow, mapping, fallbackPlayer, name } = importing;
    const { out, skipped } = buildGeneric(headers, raw.slice(headerRow + 1), mapping, fallbackPlayer);
    setImporting(null);
    if (!out.length) { say(`Nothing imported from ${name}: map at least player, season or date, attempts and yards.`, "err"); return; }
    await commitRows(out, `${name}${skipped ? ` (${skipped} rows skipped)` : ""}`);
  }
  async function addManual() {
    const season = num(form.season), att = num(form.att), yds = num(form.yds);
    if (!form.player.trim() || !form.opp.trim() || !season || att === null || yds === null) { say("Manual entry needs at least player, opponent, season, attempts and yards.", "err"); return; }
    const st = form.st === "POST" ? "POST" : "REG";
    const team = normTeam(form.team || "UNK", season), opp = normTeam(form.opp, season);
    const week = num(form.week);
    const opt = (k) => (form[k] === "" ? null : num(form[k]));
    const row = {
      id: `${season}|${st}|${week !== null ? week : "x"}|${team}|${nameKey(form.player)}`, player: form.player.trim(), team, opp, season, week, st, date: null, loc: form.loc || null,
      cmp: num(form.cmp) || 0, att, yds, td: num(form.td) || 0, int: nz(opt("int"), 0), sk: opt("sk"), skY: opt("skY"), fl: opt("fl"), ra: opt("ra"), ry: opt("ry"), rtd: opt("rtd"), qbr: opt("qbr"), qbrRaw: null, res: null, src: "manual",
    };
    await commitRows([row], "manual entry");
    setForm({ ...form, player: "", cmp: "", att: "", yds: "", td: "", int: "", sk: "", skY: "", fl: "", ra: "", ry: "", rtd: "", qbr: "" });
    setTab("rank");
    setSearch(`${row.player.split(" ").slice(-1)[0]} ${season}`);
  }
  async function clearAll() {
    if (!confirmClear) { setConfirmClear(true); return; }
    setConfirmClear(false);
    if (store.available()) { const keys = await store.list("qbdb:s:"); for (const k of keys) await store.del(k); }
    setRows([]);
    say("Imported data removed. Landmark seed games stay unless you turn them off.");
  }
  async function liveRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    const text = await fetchText(LIVE_GAMES_URL(CURRENT_SEASON));
    if (!text) {
      say("Couldn't reach nflverse from this view. The hosted site still rebuilds itself every week; here you can load the season file by hand.", "err");
      setRefreshing(false);
      return;
    }
    parseCsvInput(
      text,
      async (res) => {
        if (res.kind !== "nflverse") { say("nflverse returned a file in an unexpected layout.", "err"); setRefreshing(false); return; }
        const built = buildNflverse(res.headers, res.rows);
        let next = mergeRows(rowsRef.current, built);
        let qbrNote = "";
        const qtext = await fetchText(LIVE_QBR_URL);
        if (qtext) {
          await new Promise((resolve) => parseCsvInput(qtext, (q) => { const out = applyQbrRows(next, q.headers, q.rows); next = out.rows; qbrNote = `, QBR attached to ${out.matched.toLocaleString()} games`; resolve(); }, () => resolve()));
        }
        setRows(next);
        await persistSeasons(next, [CURRENT_SEASON]);
        setBundle((b) => ({ ...(b || {}), games: b ? b.games : built.length, through: latestWeek(next), built: new Date().toISOString().slice(0, 10) }));
        say(`Pulled ${built.length.toLocaleString()} ${CURRENT_SEASON} game lines from nflverse${qbrNote}.`);
        setRefreshing(false);
      },
      (err) => { say(`Could not read the nflverse file: ${err && err.message ? err.message : err}`, "err"); setRefreshing(false); },
    );
  }
  function exportCsv() {
    try {
      const head = ["rank", "score", "player", "team", "opponent", "season", "week", "type", "date", "cmp", "att", "pass_yds", "pass_td", "int", "sacks", "sack_yds", "fum_lost", "rush_att", "rush_yds", "rush_td", "qbr", "passer_rating", "opp_pass_d_rank"];
      const lines = [head.join(",")];
      for (const s of model.scored) {
        const r = s.r;
        lines.push([s.rank, fmt1(s.score), `"${r.player.replace(/"/g, "'")}"`, r.team, r.opp, r.season, nz(r.week, ""), r.st, nz(r.date, ""), r.cmp, r.att, r.yds, r.td, nz(r.int, ""), nz(r.sk, ""), nz(r.skY, ""), nz(r.fl, ""), nz(r.ra, ""), nz(r.ry, ""), nz(r.rtd, ""), nz(s.q, ""), s.d.rating === null ? "" : fmt1(s.d.rating), nz(s.defRank, "")].join(","));
      }
      const blob = new Blob([lines.join("\n")], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "qb_game_rankings.csv"; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) { say("Download is blocked in this view. Open the app on desktop to export.", "err"); }
  }

  const shown = visible.slice(0, page * PAGE);
  const tabs = [["rank", "Rankings"], ["data", "Data"], ["model", "Model"]];
  const seasonSpan = seasonsAvailable.length ? `${seasonsAvailable[0]}–${seasonsAvailable[seasonsAvailable.length - 1]}` : "";
  const thin = model.fullSeasons === 0;

  return (
    <div className="min-h-screen font-sans" style={{ background: C.base, color: C.text }}>
      <header className="px-4 pt-5 pb-3 sticky top-0 z-10" style={{ background: C.base, borderBottom: `1px solid ${C.line}` }}>
        <h1 className="text-2xl font-black tracking-tight leading-none">QB Game Rankings</h1>
        <p className="text-sm mt-1" style={{ color: C.muted }}>
          {model.N ? `${model.N.toLocaleString()} games ranked, ${seasonsAvailable.length} season${seasonsAvailable.length === 1 ? "" : "s"} (${seasonSpan})` : loaded ? "Nothing loaded yet" : "Loading saved games…"}
        </p>
        {bundle && bundle.through && (
          <p className="text-xs mt-0.5" style={{ color: C.muted }}>Data through {bundle.through}{bundle.built ? `, rebuilt ${fmtDate(bundle.built)}` : ""}</p>
        )}
        <div className="flex gap-1 mt-3 rounded-lg p-1" style={{ background: C.surface }}>
          {tabs.map(([k, label]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className="flex-1 rounded-md py-1.5 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
              style={{ background: tab === k ? C.surface2 : "transparent", color: tab === k ? C.text : C.muted }}>
              {label}
            </button>
          ))}
        </div>
      </header>

      {notice && (
        <div className="mx-4 mt-3 rounded-lg px-3 py-2 text-sm flex items-start justify-between gap-3" style={{ background: notice.kind === "err" ? "#3a2320" : "#1e3a2f", border: `1px solid ${notice.kind === "err" ? C.neg : C.pos}` }}>
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} className="text-xs shrink-0" style={{ color: C.muted }}>Dismiss</button>
        </div>
      )}

      {/* ---------------- RANKINGS ---------------- */}
      {tab === "rank" && (
        <div className="pb-10">
          <div className="px-4 pt-3 space-y-2">
            <input
              className={inputCls} style={inputStyle} value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search a QB, team or season, or #rank" aria-label="Search rankings"
            />
            <div className="grid grid-cols-4 gap-2">
              <select className={`${inputCls} col-span-1`} style={inputStyle} value={dir} onChange={(e) => setDir(e.target.value)} aria-label="Order">
                <option value="best">Best first</option>
                <option value="worst">Worst first</option>
              </select>
              <select className={`${inputCls} col-span-1`} style={inputStyle} value={stFilter} onChange={(e) => setStFilter(e.target.value)} aria-label="Game type">
                <option value="ALL">All games</option>
                <option value="REG">Regular</option>
                <option value="POST">Playoffs</option>
              </select>
              <select className={`${inputCls} col-span-1`} style={inputStyle} value={seasonMin} onChange={(e) => setSeasonMin(e.target.value)} aria-label="From season">
                <option value="">From…</option>
                {seasonsAvailable.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <select className={`${inputCls} col-span-1`} style={inputStyle} value={seasonMax} onChange={(e) => setSeasonMax(e.target.value)} aria-label="To season">
                <option value="">To…</option>
                {seasonsAvailable.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          {thin && model.N > 0 && (
            <div className="mx-4 mt-3 rounded-lg px-3 py-2 text-xs" style={{ background: C.surface, border: `1px solid ${C.line}`, color: C.muted }}>
              Only landmark games are loaded, so scores compare these games with each other rather than with a full season. Load a season under Data for true era-adjusted ranks.
            </div>
          )}

          <div className="px-4 pt-3 pb-1 text-xs flex justify-between" style={{ color: C.muted }}>
            <span>{visible.length.toLocaleString()} shown{visible.length !== model.N ? ` of ${model.N.toLocaleString()}` : ""}</span>
            <span>50 = average game, 10 points = 1σ</span>
          </div>

          {model.N === 0 && loaded && (
            <div className="mx-4 mt-4 rounded-xl p-5 text-sm" style={{ background: C.surface, border: `1px solid ${C.line}` }}>
              No games to rank. Open <b>Data</b> to load a season or turn the landmark seed games back on.
            </div>
          )}
          {model.N > 0 && visible.length === 0 && (
            <div className="mx-4 mt-4 rounded-xl p-5 text-sm" style={{ background: C.surface, border: `1px solid ${C.line}` }}>
              No games match. Try a last name and a season, like <span className="tabular-nums">rush 2026</span>, or a rank like <span className="tabular-nums">#10482</span>.
            </div>
          )}

          <ul>
            {shown.map((s) => (
              <RankRow key={s.r.id} s={s} open={open === s.r.id} onToggle={() => setOpen(open === s.r.id ? null : s.r.id)} weights={weights} showWorst={dir === "worst"} />
            ))}
          </ul>
          {shown.length < visible.length && (
            <div className="px-4 py-4">
              <Button onClick={() => setPage(page + 1)} className="w-full">Show {Math.min(PAGE, visible.length - shown.length)} more</Button>
            </div>
          )}
        </div>
      )}

      {/* ---------------- DATA ---------------- */}
      {tab === "data" && (
        <div className="px-4 pt-4 pb-10">
          <Panel title="Weekly updates" note="The hosted site rebuilds itself every Tuesday from nflverse, so every game through the latest week is already ranked when you open it. This button pulls the current season right now instead of waiting.">
            <Button tone="primary" onClick={liveRefresh} disabled={refreshing} className="w-full">
              {refreshing ? `Pulling ${CURRENT_SEASON} from nflverse…` : `Check nflverse for new ${CURRENT_SEASON} games`}
            </Button>
            {bundle && (
              <p className="text-xs mt-2" style={{ color: C.muted }}>Built-in dataset: {bundle.games.toLocaleString()} games{bundle.through ? `, through ${bundle.through}` : ""}.</p>
            )}
          </Panel>

          <Panel title="Load games" note="Drop in any CSV of quarterback game lines. nflverse and ESPN QBR files are recognized automatically; anything else opens a column mapper.">
            <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" />
            <Button tone="primary" onClick={() => fileRef.current && fileRef.current.click()} disabled={!!importing} className="w-full">
              {importing && importing.stage === "parsing" ? `Reading ${importing.name}…` : "Choose a CSV file"}
            </Button>
            <div className="text-xs mt-3 space-y-2" style={{ color: C.muted }}>
              <p><b style={{ color: C.text }}>Every game since 1999:</b> nflverse publishes free week-level player stats per season at github.com/nflverse/nflverse-data/releases/tag/stats_player (look for the week-level CSV for each season). Passing, sacks, fumbles and rushing are all included.</p>
              <p><b style={{ color: C.text }}>QBR (2006 on):</b> the espn_data release on the same site has a week-level QBR CSV. Load it after the passing stats and it attaches to matching games.</p>
              <p><b style={{ color: C.text }}>Before 1999:</b> export game logs from Pro-Football-Reference or Stathead and map the columns when asked. Sacks start in the 1960s and lost fumbles are patchy before the 1990s; missing stats count as league-average, never as a penalty.</p>
            </div>
          </Panel>

          {importing && importing.stage === "map" && (
            <Panel title={`Map columns: ${importing.name}`} note="Pick which column holds each stat. Only player, season (or date), attempts and yards are required.">
              <Field label="Header row">
                <select className={inputCls} style={inputStyle} value={importing.headerRow} onChange={(e) => setHeaderRow(Number(e.target.value))}>
                  {importing.raw.slice(0, 6).map((r, i) => <option key={i} value={i}>Row {i + 1}: {r.slice(0, 5).map((x) => String(nz(x, ""))).join(", ").slice(0, 60)}</option>)}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-2 mt-3">
                {TARGETS.map(([k, label]) => (
                  <Field key={k} label={label}>
                    <select className={inputCls} style={inputStyle} value={importing.mapping[k] || ""} onChange={(e) => setImporting({ ...importing, mapping: { ...importing.mapping, [k]: e.target.value } })}>
                      <option value="">—</option>
                      {importing.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </Field>
                ))}
              </div>
              <div className="mt-3">
                <Field label="Player name, if the file has no player column (single-player game logs)">
                  <input className={inputCls} style={inputStyle} value={importing.fallbackPlayer} onChange={(e) => setImporting({ ...importing, fallbackPlayer: e.target.value })} placeholder="e.g. Dan Marino" />
                </Field>
              </div>
              <div className="flex gap-2 mt-4">
                <Button tone="primary" onClick={finishGeneric} className="flex-1">Import {(importing.raw.length - importing.headerRow - 1).toLocaleString()} rows</Button>
                <Button onClick={() => setImporting(null)}>Cancel</Button>
              </div>
            </Panel>
          )}

          <Panel title="Add one game by hand" note="For a box score from yesterday, or anything the imports don't cover.">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Quarterback"><input className={inputCls} style={inputStyle} value={form.player} onChange={(e) => setForm({ ...form, player: e.target.value })} placeholder="Cooper Rush" /></Field>
              <Field label="Team (code)"><input className={inputCls} style={inputStyle} value={form.team} onChange={(e) => setForm({ ...form, team: e.target.value })} placeholder="BAL" /></Field>
              <Field label="Opponent (code)"><input className={inputCls} style={inputStyle} value={form.opp} onChange={(e) => setForm({ ...form, opp: e.target.value })} placeholder="PIT" /></Field>
              <Field label="Home or away">
                <select className={inputCls} style={inputStyle} value={form.loc} onChange={(e) => setForm({ ...form, loc: e.target.value })}>
                  <option value="H">Home</option><option value="A">Away</option>
                </select>
              </Field>
              <Field label="Season"><input className={inputCls} style={inputStyle} inputMode="numeric" value={form.season} onChange={(e) => setForm({ ...form, season: e.target.value })} /></Field>
              <Field label="Week"><input className={inputCls} style={inputStyle} inputMode="numeric" value={form.week} onChange={(e) => setForm({ ...form, week: e.target.value })} /></Field>
              <Field label="Game type">
                <select className={inputCls} style={inputStyle} value={form.st} onChange={(e) => setForm({ ...form, st: e.target.value })}>
                  <option value="REG">Regular season</option><option value="POST">Playoffs</option>
                </select>
              </Field>
              <Field label="QBR (optional)"><input className={inputCls} style={inputStyle} inputMode="decimal" value={form.qbr} onChange={(e) => setForm({ ...form, qbr: e.target.value })} /></Field>
            </div>
            <div className="grid grid-cols-4 gap-2 mt-2">
              {[["cmp", "Cmp"], ["att", "Att"], ["yds", "Yds"], ["td", "TD"], ["int", "INT"], ["sk", "Sacks"], ["skY", "Sk yds"], ["fl", "Fum lost"], ["ra", "Rush att"], ["ry", "Rush yds"], ["rtd", "Rush TD"]].map(([k, label]) => (
                <Field key={k} label={label}><input className={inputCls} style={inputStyle} inputMode="numeric" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></Field>
              ))}
            </div>
            <Button tone="primary" onClick={addManual} className="w-full mt-3">Add game and show its rank</Button>
          </Panel>

          <Panel title="What's loaded" note={store.available() ? "Imported games are saved on this device and reload automatically." : "This view can't save between sessions, so imported games last until you close it."}>
            {coverage.length === 0 && <p className="text-sm" style={{ color: C.muted }}>Nothing yet.</p>}
            {coverage.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs tabular-nums">
                  <thead>
                    <tr style={{ color: C.muted }}>
                      <th className="text-left font-normal py-1">Season</th>
                      <th className="text-right font-normal py-1">Games</th>
                      <th className="text-right font-normal py-1">Sacks</th>
                      <th className="text-right font-normal py-1">Fumbles</th>
                      <th className="text-right font-normal py-1">QBR</th>
                      <th className="text-right font-normal py-1">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {coverage.map((c) => (
                      <tr key={c.season} style={{ borderTop: `1px solid ${C.line}` }}>
                        <td className="py-1">{c.season}</td>
                        <td className="py-1 text-right">{c.n.toLocaleString()}</td>
                        <td className="py-1 text-right">{c.sk ? `${Math.round((100 * c.sk) / c.n)}%` : "—"}</td>
                        <td className="py-1 text-right">{c.fl ? `${Math.round((100 * c.fl) / c.n)}%` : "—"}</td>
                        <td className="py-1 text-right">{c.qbr ? `${Math.round((100 * c.qbr) / c.n)}%` : "—"}</td>
                        <td className="py-1 text-right" style={{ color: C.muted }}>{[...c.src].join(", ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex gap-2 mt-4">
              <Button onClick={exportCsv} disabled={!model.N} className="flex-1">Export rankings CSV</Button>
              <Button tone="danger" onClick={clearAll} disabled={!rows.length}>{confirmClear ? "Tap again to delete" : "Delete imported data"}</Button>
            </div>
            <Toggle label="Show landmark seed games" hint="33 verified record games (500-yard and 7-TD games). Hidden automatically for any season you import." checked={settings.includeSeed} onChange={(v) => setSettings({ ...settings, includeSeed: v })} />
          </Panel>
        </div>
      )}

      {/* ---------------- MODEL ---------------- */}
      {tab === "model" && (
        <div className="px-4 pt-4 pb-10">
          <Panel title="Weights" note="Each stat becomes a z-score against its season, gets multiplied by its weight, and the total is scaled so 50 is a league-average game. Turnovers and sacks always count against a game.">
            {COMPONENTS.map((c) => (
              <div key={c.key} className="py-2">
                <div className="flex justify-between text-sm mb-1">
                  <span>{c.label}</span>
                  <span className="tabular-nums" style={{ color: C.accent }}>{c.sign < 0 ? "−" : ""}{(weights[c.key] || 0).toFixed(1)}</span>
                </div>
                <input type="range" min="0" max="2" step="0.1" value={weights[c.key]} onChange={(e) => setWeights({ ...weights, [c.key]: Number(e.target.value) })} className="w-full" style={{ accentColor: C.accent }} aria-label={`${c.label} weight`} />
              </div>
            ))}
            <Button onClick={() => setWeights(DEFAULT_WEIGHTS)} className="mt-2">Reset weights</Button>
          </Panel>

          <Panel title="Rules">
            <Toggle label="Adjust for era" hint="Compare each game with its own season. Off = compare every game with all loaded games on raw numbers." checked={settings.eraAdjust} onChange={(v) => setSettings({ ...settings, eraAdjust: v })} />
            <Toggle label="Include playoff games" checked={settings.includePost} onChange={(v) => setSettings({ ...settings, includePost: v })} />
            <div className="py-2">
              <div className="flex justify-between text-sm mb-1"><span>Minimum pass attempts to be ranked</span><span className="tabular-nums" style={{ color: C.accent }}>{settings.minAtt}</span></div>
              <input type="range" min="1" max="30" step="1" value={settings.minAtt} onChange={(e) => setSettings({ ...settings, minAtt: Number(e.target.value) })} className="w-full" style={{ accentColor: C.accent }} aria-label="Minimum attempts" />
            </div>
            <div className="py-2">
              <div className="flex justify-between text-sm mb-1"><span>Games needed to rate a defense</span><span className="tabular-nums" style={{ color: C.accent }}>{settings.minDefGames}</span></div>
              <input type="range" min="2" max="12" step="1" value={settings.minDefGames} onChange={(e) => setSettings({ ...settings, minDefGames: Number(e.target.value) })} className="w-full" style={{ accentColor: C.accent }} aria-label="Minimum games to rate a defense" />
            </div>
            <div className="py-2">
              <div className="text-sm mb-1">Which QBR to use</div>
              <div className="flex gap-2">
                {[["total", "Total QBR"], ["raw", "Raw QBR"]].map(([v, label]) => (
                  <Button key={v} tone={settings.qbrMode === v ? "primary" : "ghost"} onClick={() => setSettings({ ...settings, qbrMode: v })} className="flex-1">{label}</Button>
                ))}
              </div>
              <p className="text-xs mt-2" style={{ color: C.muted }}>ESPN's Total QBR already bakes in opponent strength. Raw QBR does not, so it avoids counting the defense twice when the opponent weight is on.</p>
            </div>
          </Panel>

          <Panel title="How the score works">
            <div className="text-sm space-y-2" style={{ color: C.text }}>
              <p>Passing yards, completion percentage, touchdowns, turnovers, efficiency, rushing and sacks are each turned into a z-score: how many standard deviations the game sits from the average quarterback game of that season. A 350-yard game in 1978 therefore outranks the same line in 2024.</p>
              <p>Opponent strength comes from the same data. For each season the app measures how every other quarterback fared against that defense (adjusted net yards per attempt), leaving out the game being scored so a monster day can't make its own opponent look soft. A tough defense adds to the score, a weak one subtracts.</p>
              <p>QBR is used where ESPN publishes it (2006 on); passer rating stands in for earlier seasons. Stats that were never recorded for a game count as league-average rather than as zero. Seasons with fewer than {MIN_POOL} loaded games borrow their decade's baseline, then the whole loaded set.</p>
              <p>Weighted z-scores are summed, divided by the size of the weight vector, and mapped to a score where 50 is average and each 10 points is one standard deviation. Record games land above 100; disasters below 0.</p>
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}
