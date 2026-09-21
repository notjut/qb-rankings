/* QB Game Rankings: loads the weekly data files, scores every full game, draws the page. No libraries. */
(function () {
  "use strict";

  /* ---------- the model (fixed; visitors cannot change it) ---------- */
  const WEIGHTS = { to: 1.2, yds: 1.0, eff: 1.0, td: 0.8, def: 0.7, cmp: 0.6, rush: 0.5, sk: 0.4 };
  const COMPONENTS = [
    { key: "yds", stat: "yds", label: "Passing yards", sign: 1 },
    { key: "td", stat: "td", label: "Touchdown passes", sign: 1 },
    { key: "to", stat: "to", label: "Turnovers", sign: -1 },
    { key: "eff", stat: null, label: "QBR", sign: 1 },
    { key: "cmp", stat: "cmpPct", label: "Completion rate", sign: 1 },
    { key: "rush", stat: "rush", label: "Rushing", sign: 1 },
    { key: "sk", stat: "sk", label: "Sacks taken", sign: -1 },
    { key: "def", stat: null, label: "Defense faced", sign: 1 },
  ];
  const STAT_KEYS = ["yds", "cmpPct", "td", "to", "rating", "qbr", "rush", "sk"];
  const MIN_ATT = 10, MIN_POOL = 60, MIN_DEF_GAMES = 6, PAGE = 50, BIG_TIME = 70, RECENT_WEEKS = 4;

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
  const CANON = { WSH: "WAS", LAR: "LA", JAC: "JAX", GNB: "GB", KAN: "KC", NWE: "NE", NOR: "NO", SFO: "SF", TAM: "TB", SDG: "SD", LVR: "LV", RAI: "OAK", RAM: "LA", OTI: "TEN", CRD: "ARI", CLT: "IND", HTX: "HOU", RAV: "BAL" };
  function normTeam(code, season) {
    let u = String(code || "").toUpperCase().trim();
    if (!u) return "UNK";
    u = CANON[u] || u;
    if (u === "OAK" && season >= 2020) u = "LV";
    if (u === "LV" && season < 2020) u = "OAK";
    if (u === "LA" && season <= 2015) u = "STL";
    if (u === "STL" && season > 2015) u = "LA";
    if (u === "SD" && season >= 2017) u = "LAC";
    if (u === "LAC" && season <= 2016) u = "SD";
    return u;
  }
  function nick(code, season) {
    if (code === "WAS") return season >= 2022 ? "Commanders" : season >= 2020 ? "Washington" : "Redskins";
    return NICK[code] || code || "?";
  }
  let TEAMS = {};
  function colors(code) {
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
    return {
      cmpPct: (r.cmp / r.att) * 100, to: r.int + r.fl, rush: r.ry + 20 * r.rtd,
      rating: passerRating(r.cmp, r.att, r.yds, r.td, r.int), sk: r.sk,
      any: den > 0 ? (r.yds + 20 * r.td - 45 * r.int - r.skY) / den : null,
    };
  }
  function computeModel(rows) {
    const add = (acc, k, v) => { if (v === null || v === undefined || !Number.isFinite(v)) return; const a = acc[k] || (acc[k] = { n: 0, s: 0, ss: 0 }); a.n++; a.s += v; a.ss += v * v; };
    const stats = (a, pool) => { if (!a || a.n < 2) return null; const m = a.s / a.n; return { m, sd: Math.sqrt(Math.max(a.ss / a.n - m * m, 0)), n: a.n, pool }; };
    const qual = rows.filter((r) => r.att >= MIN_ATT);
    const derived = new Map(qual.map((r) => [r, derive(r)]));
    const seasonAcc = new Map(), decadeAcc = new Map(), globalAcc = {}, defBySeason = new Map();
    for (const r of qual) {
      const d = derived.get(r);
      const vals = { yds: r.yds, cmpPct: d.cmpPct, td: r.td, to: d.to, rating: d.rating, qbr: r.qbr, rush: d.rush, sk: d.sk };
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
        return (v - b.m) / b.sd;
      };
      z.yds = zv("yds", "yds", r.yds); z.cmp = zv("cmp", "cmpPct", d.cmpPct); z.td = zv("td", "td", r.td); z.to = zv("to", "to", d.to);
      let effSrc = "qbr";
      z.eff = r.qbr !== null ? zv("eff", "qbr", r.qbr) : null;
      if (z.eff === null) { z.eff = zv("eff", "rating", d.rating); effSrc = "rating"; }
      z.rush = zv("rush", "rush", d.rush); z.sk = zv("sk", "sk", d.sk);
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
      scored.push({ r, d, z, pts, avg, score: 50 + total, effSrc, defRank, defCount, pool, hay });
    }
    scored.sort((a, b) => b.score - a.score || b.r.yds - a.r.yds);
    scored.forEach((s, i) => { s.rank = i + 1; });
    return scored;
  }

  /* ---------- wording ---------- */
  function weekLabel(r) {
    if (r.st !== "POST") return `Week ${r.week}`;
    const i = r.week - (r.season >= 2021 ? 18 : 17);
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
    if (r.ry || r.rtd) bits.push(`${r.ry} rush yds${r.rtd ? `, ${r.rtd} rush TD` : ""}`);
    return bits.join(" · ");
  }
  function topPct(s, N) { const p = (s.rank / N) * 100; return p <= 1 ? "Top 1%" : p <= 50 ? `Top ${Math.ceil(p)}%` : `Bottom ${Math.max(1, Math.ceil(100 - p))}%`; }
  function phrase(s, key) {
    const r = s.r, d = s.d, good = s.pts[key] > 0;
    switch (key) {
      case "yds": return `${int(r.yds)} passing yards`;
      case "td": return r.td === 0 ? "no touchdown passes" : plural(r.td, "touchdown pass").replace("passs", "passes");
      case "to": return d.to === 0 ? "no turnovers" : plural(d.to, "turnover");
      case "eff": return s.effSrc === "qbr" ? `a ${one(r.qbr)} QBR` : `a ${one(d.rating)} passer rating`;
      case "cmp": return `${Math.round(d.cmpPct)}% completions`;
      case "rush": return `${good ? "" : "only "}${r.ry} rushing yards${r.rtd ? ` and ${plural(r.rtd, "rushing touchdown")}` : ""}`;
      case "sk": return r.sk === 0 ? "no sacks taken" : plural(r.sk, "sack") + " taken";
      case "def": return `${good ? "a tough" : "a soft"} ${nick(r.opp, r.season)} defense${s.defRank ? ` (#${s.defRank} of ${s.defCount} against quarterbacks that year)` : ""}`;
    }
    return key;
  }
  function explain(s, N) {
    const keys = COMPONENTS.map((c) => c.key).filter((k) => s.pts[k] !== null);
    const helped = keys.filter((k) => s.pts[k] >= 1.5).sort((a, b) => s.pts[b] - s.pts[a]).slice(0, 3);
    const hurt = keys.filter((k) => s.pts[k] <= -1.5).sort((a, b) => s.pts[a] - s.pts[b]).slice(0, 3);
    const better = ((N - s.rank) / N) * 100;
    const out = [`Ranked #${int(s.rank)} of ${int(N)} full games. Better than ${better >= 99.95 ? "99.9" : better < 0.05 ? "0" : one(better)}% of them.`];
    out.push(helped.length ? `What lifted it: ${joinAnd(helped.map((k) => phrase(s, k)))}.` : "Nothing stood out on the plus side.");
    out.push(hurt.length ? `What held it back: ${joinAnd(hurt.map((k) => phrase(s, k)))}.` : "Nothing held it back.");
    return out;
  }

  /* ---------- pieces of page ---------- */
  let HEADS = {};
  function photo(s, width, stripe) {
    const r = s.r, { c1, c2 } = colors(r.team);
    const initials = r.player.split(/\s+/).map((p) => p[0]).slice(0, 2).join("");
    let url = HEADS[r.pid] || "";
    if (url) url = url.replace("f_auto,q_auto", `f_auto,q_auto,w_${width}`);
    return `<span class="ph" style="background:${esc(c1)}"><span class="ini" style="color:${readableOn(c1)}">${esc(initials)}</span>` +
      (url ? `<img src="${esc(url)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : "") +
      (stripe ? `<span class="stripe" style="background:${esc(c2)}"></span>` : "") + `</span>`;
  }
  function card(s, N, tag) {
    const r = s.r;
    return `<button type="button" class="card" data-id="${esc(r.id)}">${photo(s, 480, true)}
      <span class="row1"><span>${esc(r.player)}</span><span>${one(s.score)}</span></span>
      <span class="meta" style="display:block">${esc(matchup(r))} · ${esc(tag || when(r))}</span>
      <span class="meta" style="display:block">${esc(statLine(r))}</span>
      <span class="meta" style="display:block">All-time #${int(s.rank)} · ${topPct(s, N)}</span></button>`;
  }
  function renderWeek(scored, N, latest) {
    const games = scored.filter((s) => s.r.season === latest.season && s.r.week === latest.week);
    if (!games.length) { $("week").hidden = true; return new Set(); }
    const top = games[0], r = top.r;
    const label = r.st === "POST" ? weekLabel(r) : `Week ${latest.week}`;
    let html = `<h2>${esc(label)} recap <span>${latest.season} season · ${plural(games.length, "full game")}</span></h2>
      <button type="button" class="hero" data-id="${esc(r.id)}">${photo(top, 960, true)}
        <span><span class="tag" style="display:block">Game of the week</span>
        <span class="name" style="display:block">${esc(r.player)}</span>
        <span style="display:block">${esc(matchup(r))}${resultText(r) ? " · " + esc(resultText(r)) : ""}</span>
        <span class="meta" style="display:block">${esc(statLine(r))}</span>
        <span class="big" style="display:block">${one(top.score)}</span>
        <span class="meta" style="display:block">All-time #${int(top.rank)} of ${int(N)} · ${topPct(top, N)}</span>
        <span class="why-link">See why</span></span></button>`;
    const rest = games.slice(1, 5);
    if (rest.length) html += `<div class="grid">${rest.map((s, i) => card(s, N, `#${i + 2} this week`)).join("")}</div>`;
    if (games.length >= 6) {
      const low = games[games.length - 1];
      html += `<p class="meta" style="margin:36px 0 0">Toughest day: <button type="button" data-id="${esc(low.r.id)}" style="border-bottom:1px solid currentColor">${esc(low.r.player)}, ${one(low.score)}</button></p>`;
    }
    $("weekBody").innerHTML = html;
    return new Set(games.slice(0, 5));
  }
  function renderBigTime(scored, N, latest, shown) {
    const pool = scored.filter((s) => s.r.season === latest.season && s.r.week > latest.week - RECENT_WEEKS && !shown.has(s));
    let picks = pool.filter((s) => s.score >= BIG_TIME);
    if (picks.length < 4) picks = pool.slice(0, 4);
    picks = picks.slice(0, 8);
    if (!picks.length) { $("bigtime").hidden = true; return; }
    $("bigBody").innerHTML = `<h2>Big-time performances <span>Best of the last ${RECENT_WEEKS} weeks</span></h2>
      <div class="grid" style="margin-top:0">${picks.map((s) => card(s, N)).join("")}</div>`;
  }
  function row(s) {
    const r = s.r;
    return `<button type="button" class="g" data-id="${esc(r.id)}"><span class="rank">#${int(s.rank)}</span>${photo(s, 96, false)}
      <span style="min-width:0"><span class="nm" style="display:block">${esc(r.player)}</span>
      <span class="sub" style="display:block">${esc(matchup(r))} · ${esc(when(r))}</span>
      <span class="line" style="display:block">${esc(statLine(r))}</span></span><span class="sc">${one(s.score)}</span></button>`;
  }

  /* ---------- explanation sheet ---------- */
  function openSheet(s, N, onPlayer) {
    const r = s.r, d = s.d, { c1 } = colors(r.team);
    const maxPts = Math.max(8, ...COMPONENTS.map((c) => Math.abs(s.pts[c.key] || 0)));
    const val = {
      yds: int(r.yds), td: String(r.td), to: String(d.to), eff: s.effSrc === "qbr" ? one(r.qbr) : one(d.rating), cmp: `${Math.round(d.cmpPct)}%`,
      rush: `${r.ry} yds${r.rtd ? ` + ${r.rtd} TD` : ""}`, sk: String(r.sk), def: s.defRank ? `#${s.defRank} of ${s.defCount}` : "—",
    };
    const avgText = (k) => {
      const a = s.avg[k];
      if (a === undefined) return "—";
      if (k === "cmp") return `${Math.round(a)}%`;
      if (k === "yds") return int(a);
      if (k === "rush") return `${Math.round(a)} yds`;
      return one(a);
    };
    const rows = COMPONENTS.map((c) => {
      const p = s.pts[c.key];
      const label = c.key === "eff" ? (s.effSrc === "qbr" ? "QBR" : "Passer rating") : c.label;
      const w = p === null ? 0 : (Math.abs(p) / maxPts) * 50;
      const bar = p === null ? "" : p >= 0 ? `<i class="pos" style="width:${w}%;background:${esc(c1 === "#FFFFFF" ? "#000" : c1)}"></i>` : `<i class="neg" style="width:${w}%"></i>`;
      return `<tr><td>${esc(label)}</td><td class="v">${esc(val[c.key])}</td><td class="v avg">${avgText(c.key)}</td>
        <td style="width:36%;padding-left:14px"><div class="bar">${bar}</div></td><td class="v">${p === null ? "n/a" : (p >= 0 ? "+" : "−") + one(Math.abs(p))}</td></tr>`;
    }).join("");
    const poolNote = s.pool === "season" ? `every other full game of the ${r.season} season` : s.pool === "decade" ? `full games from the ${Math.floor(r.season / 10) * 10}s, because the ${r.season} season is still young` : "every full game on record";
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
      <div style="overflow-x:auto"><table class="bk"><thead><tr><th>Category</th><th class="v">This game</th><th class="v avg">${r.season} average</th><th></th><th class="v">Points</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
      <p class="note" style="margin-top:16px">Start at 50, add the points column, and you get ${one(s.score)}. Solid bars add points. Striped bars take them away.</p>
      <p class="note">Measured against ${esc(poolNote)}.${r.share !== null ? ` He took ${Math.round(r.share * 100)}% of his team's quarterback snaps, so it counts as a full game.` : ""}</p>
      <button type="button" class="btn" id="allBy">All games by ${esc(r.player)}</button></div>`;
    $("closeSheet").onclick = () => sheet.close();
    $("allBy").onclick = () => { sheet.close(); onPlayer(r.player); };
    if (!sheet.open) sheet.showModal();
    sheet.scrollTop = 0;
  }

  /* ---------- start ---------- */
  async function start() {
    const [games, qbr, players, teams] = await Promise.all([getJson("data/qb_games.json"), getJson("data/qbr.json"), getJson("data/players.json"), getJson("data/teams.json")]);
    if (!games || !games.rows) { $("status").textContent = "Could not load the game data. Try again in a minute."; return; }
    HEADS = (players && players.headshots) || {};
    TEAMS = (teams && teams.teams) || {};
    const rows = buildRows(games);
    attachQbr(rows, qbr);
    const scored = computeModel(rows);
    const N = scored.length;
    const byId = new Map(scored.map((s) => [s.r.id, s]));
    const seasons = [...new Set(scored.map((s) => s.r.season))].sort((a, b) => b - a);
    const latestSeason = seasons[0];
    const latest = { season: latestSeason, week: Math.max(...scored.filter((s) => s.r.season === latestSeason).map((s) => s.r.week)) };
    const latestGame = scored.find((s) => s.r.season === latest.season && s.r.week === latest.week);

    $("status").textContent = `${int(N)} full games · ${seasons[seasons.length - 1]}–${latestSeason} · through ${when(latestGame.r)}${games.built ? ` · updated ${fmtDate(games.built)}` : ""}`;
    const top = renderWeek(scored, N, latest);
    renderBigTime(scored, N, latest, top);

    const state = { q: "", season: "", type: "", order: "best", limit: PAGE };
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
      $("allCount").textContent = `${int(N)} games`;
      $("shown").textContent = list.length === N ? "Tap any game to see why it ranks where it does" : `${plural(list.length, "game")} found · rank shown is the all-time rank`;
      $("list").innerHTML = page.length ? page.map(row).join("") : `<p class="empty">No games match. Try a last name, a team or a year.</p>`;
      $("more").hidden = list.length <= state.limit;
    }
    const reset = () => { state.limit = PAGE; renderList(); };
    let timer = null;
    $("q").addEventListener("input", (e) => { clearTimeout(timer); timer = setTimeout(() => { state.q = e.target.value; reset(); }, 120); });
    $("fSeason").addEventListener("change", (e) => { state.season = e.target.value; reset(); });
    $("fType").addEventListener("change", (e) => { state.type = e.target.value; reset(); });
    $("fOrder").addEventListener("change", (e) => { state.order = e.target.value; reset(); });
    $("more").addEventListener("click", () => { state.limit += PAGE; renderList(); });
    renderList();

    const showPlayer = (name) => {
      state.q = name; state.season = ""; state.type = ""; state.order = "best";
      $("q").value = name; $("fSeason").value = ""; $("fType").value = ""; $("fOrder").value = "best";
      reset();
      $("all").scrollIntoView();
    };
    document.addEventListener("click", (e) => {
      const el = e.target.closest("[data-id]");
      if (el && byId.has(el.dataset.id)) openSheet(byId.get(el.dataset.id), N, showPlayer);
    });
    const sheet = $("sheet");
    sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.close(); });
  }
  start();
})();
