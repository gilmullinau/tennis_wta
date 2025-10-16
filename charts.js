// charts.js — robust EDA for WTA dashboard (Chart.js + PapaParse only)

/* ============================
   Helpers
=============================*/

const NUMERIC_HINTS = [
  "rank_1","rank_2","pts_1","pts_2","odd_1","odd_2",
  "rank1","rank2","pts1","pts2","odd1","odd2",
  "rank_diff","pts_diff","odd_diff",
  "h2h_advantage","last_winner","surface_winrate_adv",
  "y","year"
];

const DISPLAY_NAMES = {
  rank_1: "Rank_1", rank_2: "Rank_2",
  pts_1: "Pts_1", pts_2: "Pts_2",
  odd_1: "Odd_1", odd_2: "Odd_2",
  rank1: "Rank_1", rank2: "Rank_2",
  pts1: "Pts_1", pts2: "Pts_2",
  odd1: "Odd_1", odd2: "Odd_2",
  rank_diff: "Rank Difference",
  pts_diff: "Points Difference",
  odd_diff: "Odds Difference",
  h2h_advantage: "Head-to-Head Advantage",
  last_winner: "Last Winner",
  surface_winrate_adv: "Surface Winrate Advantage",
  y: "Target (Fav. Wins)",
  year: "Year"
};

function toNum(x) {
  if (x === null || x === undefined) return NaN;
  if (typeof x === "number") return x;
  const s = String(x).replace(/\s|%|,/g, "");
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : NaN;
}

function isLikelyNumericCol(colName) {
  const low = colName.toLowerCase();
  return NUMERIC_HINTS.includes(low) || /(\d|rank|pts|odd|year|diff|score_\d+|winrate)/i.test(low);
}

function parseDateToYear(s) {
  if (!s) return NaN;
  const d = new Date(s);
  const year = d instanceof Date && !isNaN(d) ? d.getFullYear() : NaN;
  if (!isNaN(year)) return year;
  const parts = String(s).split(/\D+/).map(Number).filter(n => !isNaN(n));
  const y = parts.find(p => p > 1900 && p < 2100);
  return y ?? NaN;
}

function percent(n, d) {
  if (!d || d <= 0) return 0;
  return Math.round((n / d) * 1000) / 10;
}

function uniq(arr) { return [...new Set(arr)]; }
function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }

/* ============================
   State
=============================*/

let RAW = [];
let NUMERIC_COLS = [];
let CHARTS = { missing: null, dist: null, topPlayers: null, winRatePlayers: null };

/* ============================
   Bootstrap
=============================*/

init();

function init() {
  const csvFile = "wta_data.csv"; // 👈 имя файла, если нужно — поменяй здесь
  const delimiters = [",", ";", "\t"];
  let loaded = false;

  // Пробуем несколько разделителей (на случай разной локали)
  delimiters.forEach((delim) => {
    if (loaded) return;
    Papa.parse(csvFile, {
      download: true,
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      delimiter: delim,
      transformHeader: (h) =>
        h
          .trim()
          .replace(/^﻿/, "") // убираем BOM
          .replace(/\s+/g, "_")
          .replace(/\./g, ""),
      complete: (results) => {
        const data = results?.data || [];
        if (data.length > 10 && Object.keys(data[0] || {}).length > 2) {
          loaded = true;
          console.log(`✅ CSV loaded (${data.length} rows, delim='${delim}')`);
          onCsvLoaded(results);
        }
      },
      error: (err) => {
        console.warn(`⚠️ Failed with delimiter '${delim}':`, err?.message || err);
      },
    });
  });

  // Если через 2 секунды не удалось загрузить — показать сообщение
  setTimeout(() => {
    if (!loaded) {
      showDatasetInfo(`
        ⚠️ <b>Failed to load CSV file.</b><br>
        Please ensure:
        <ul style="text-align:left;display:inline-block;">
          <li>The file <code>${csvFile}</code> is located in the same folder as <code>index.html</code>.</li>
          <li>You are running the project via a local server (e.g. <code>python -m http.server</code>).</li>
        </ul>
      `);
    }
  }, 2000);
}



/* ============================
   Load & Sanity
=============================*/

function onCsvLoaded(results) {
  const { data, meta } = results || {};
  if (!Array.isArray(data) || data.length === 0) {
    showDatasetInfo("⚠️ CSV loaded, but there are no data rows. Check the file.");
    return;
  }

  const cols = (meta && meta.fields) ? meta.fields : Object.keys(data[0] || {});
  const cleaned = data.filter(row => cols.some(c => (row[c] !== null && row[c] !== undefined && String(row[c]).trim() !== "")));
  if (cleaned.length === 0) {
    showDatasetInfo("⚠️ Only empty rows or header without data.");
    return;
  }

  const norm = cleaned.map(row => {
    const r = {};
    for (const k of Object.keys(row)) r[k.trim()] = row[k];
    return r;
  });

  const derived = addDerivedColumns(norm);
  RAW = derived;

  NUMERIC_COLS = detectNumericColumns(derived);

  renderDatasetOverview(derived);
  renderMissingness(derived);
  buildFeatureButtons(NUMERIC_COLS);
  renderDistributions(derived, NUMERIC_COLS[0]); // default first numeric
  renderCorrelations(derived, NUMERIC_COLS);
  renderPlayers(derived);
}

/* ============================
   Derived columns
=============================*/

function addDerivedColumns(rows) {
  const haveYear = rows.some(r => "year" in r);
  const haveRankDiff = rows.some(r => "rank_diff" in r);
  const havePtsDiff = rows.some(r => "pts_diff" in r);
  const haveOddDiff = rows.some(r => "odd_diff" in r);

  return rows.map(r => {
    const out = { ...r };

    // Normalize common column name variants
    out.Player_1 = out.Player_1 ?? out.player_1 ?? out.player1 ?? out.P1 ?? out.p1;
    out.Player_2 = out.Player_2 ?? out.player_2 ?? out.player2 ?? out.P2 ?? out.p2;

    out.Rank_1 = out.Rank_1 ?? out.rank_1 ?? out.rank1 ?? out.RANK_1 ?? out.Rank1;
    out.Rank_2 = out.Rank_2 ?? out.rank_2 ?? out.rank2 ?? out.RANK_2 ?? out.Rank2;

    out.Pts_1 = out.Pts_1 ?? out.pts_1 ?? out.pts1 ?? out.PTS_1 ?? out.Pts1;
    out.Pts_2 = out.Pts_2 ?? out.pts_2 ?? out.pts2 ?? out.PTS_2 ?? out.Pts2;

    out.Odd_1 = out.Odd_1 ?? out.odd_1 ?? out.odd1 ?? out.ODD_1 ?? out.Odd1;
    out.Odd_2 = out.Odd_2 ?? out.odd_2 ?? out.odd2 ?? out.ODD_2 ?? out.Odd2;

    out.y = out.y ?? out.target ?? out.win ?? out.Won ?? out.won;

    // New engineered feature names (if the CSV already has them — we keep; if not but variants appear — map)
    out.h2h_advantage = out.h2h_advantage ?? out.h2h ?? out.head2head_adv ?? out.H2H_Advantage;
    out.last_winner = out.last_winner ?? out.LastWinner ?? out.prev_winner;
    out.surface_winrate_adv = out.surface_winrate_adv ?? out.surf_winrate_adv ?? out.surface_wr_adv;

    // Date/year
    const dateVal = out.Date ?? out.date ?? out.match_date ?? out.MatchDate;
    if (!("year" in out) && !haveYear) {
      const yr = parseDateToYear(dateVal);
      if (!isNaN(yr)) out.year = yr;
    }

    if (!("rank_diff" in out) && !haveRankDiff) {
      const r1 = toNum(out.Rank_1), r2 = toNum(out.Rank_2);
      if (!isNaN(r1) || !isNaN(r2)) out.rank_diff = (r2 - r1);
    }

    if (!("pts_diff" in out) && !havePtsDiff) {
      const p1 = toNum(out.Pts_1), p2 = toNum(out.Pts_2);
      if (!isNaN(p1) || !isNaN(p2)) out.pts_diff = (p1 - p2);
    }

    if (!("odd_diff" in out) && !haveOddDiff) {
      const o1 = toNum(out.Odd_1), o2 = toNum(out.Odd_2);
      if (!isNaN(o1) || !isNaN(o2)) out.odd_diff = (o2 - o1);
    }

    return out;
  });
}

/* ============================
   Column typing
=============================*/

function detectNumericColumns(rows) {
  const sample = rows.slice(0, Math.min(200, rows.length));
  const cols = uniq(sample.flatMap(r => Object.keys(r)));
  const numericCols = [];

  for (const c of cols) {
    let nCount = 0, seen = 0;
    for (const r of sample) {
      if (!(c in r)) continue;
      const v = r[c];
      if (v === "" || v === null || v === undefined) continue;
      seen++;
      if (Number.isFinite(toNum(v))) nCount++;
    }
    if (seen > 0 && nCount / seen >= 0.7 && isLikelyNumericCol(c)) numericCols.push(c);
  }

  if (!numericCols.includes("y") && rows.some(r => r.y !== undefined)) numericCols.push("y");

  if (numericCols.length === 0) {
    ["Rank_1","Rank_2","Pts_1","Pts_2","Odd_1","Odd_2",
     "rank_diff","pts_diff","odd_diff",
     "h2h_advantage","last_winner","surface_winrate_adv",
     "year","y"]
     .forEach(k => { if (rows.some(r => k in r)) numericCols.push(k); });
  }

  return uniq(numericCols);
}

/* ============================
   Overview
=============================*/

function showDatasetInfo(html) {
  const box = document.getElementById("datasetInfo");
  if (box) box.innerHTML = html;
}

function renderDatasetOverview(rows) {
  const nRows = rows.length;
  const cols = uniq(rows.flatMap(r => Object.keys(r)));
  const years = rows.map(r => toNum(r.year)).filter(v => !isNaN(v));
  const yMin = years.length ? Math.min(...years) : "—";
  const yMax = years.length ? Math.max(...years) : "—";

  const surfaces = {};
  rows.forEach(r => {
    const s = (r.Surface ?? r.surface ?? r.SURFACE ?? "").toString().toLowerCase().trim();
    if (!s) return;
    surfaces[s] = (surfaces[s] || 0) + 1;
  });
  const topSurf = Object.entries(surfaces).sort((a,b)=>b[1]-a[1]).slice(0,3)
                    .map(([k,v]) => `${k}: ${v}`);

  const html = `
    <div><strong>Rows:</strong> ${nRows}, <strong>Columns:</strong> ${cols.length}</div>
    <div><strong>Years:</strong> ${yMin}–${yMax}</div>
    <div><strong>Numeric features:</strong> ${NUMERIC_COLS.length ? NUMERIC_COLS.join(", ") : "none detected"}</div>
    ${topSurf.length ? `<div><strong>Top surfaces:</strong> ${topSurf.join(" • ")}</div>` : ""}
    ${nRows < 5 ? `<div class="badge">ℹ️ Few rows: charts may be limited but will still render.</div>` : ""}
  `;
  showDatasetInfo(html);
}

/* ============================
   Missingness
=============================*/

function renderMissingness(rows) {
  const cols = uniq(rows.flatMap(r => Object.keys(r)));
  const stats = cols.map(c => {
    let miss = 0, total = 0;
    for (const r of rows) {
      total++;
      const v = r[c];
      if (v === null || v === undefined || String(v).trim() === "") miss++;
    }
    return { col: c, missPct: percent(miss, total) };
  }).sort((a,b)=>b.missPct - a.missPct);

  const ctx = document.getElementById("missingChart").getContext("2d");
  if (CHARTS.missing) CHARTS.missing.destroy();
  CHARTS.missing = new Chart(ctx, {
    type: "bar",
    data: { labels: stats.map(s => s.col), datasets: [{ label: "% Missing", data: stats.map(s => s.missPct) }] },
    options: {
      responsive: true,
      plugins: { legend: { display: true } },
      scales: { y: { beginAtZero: true, ticks: { callback: v => v + "%" } } }
    }
  });
}

/* ============================
   Distributions (Histogram)
=============================*/

function buildFeatureButtons(numericCols) {
  const box = document.getElementById("featureButtons");
  box.innerHTML = "";
  if (!numericCols.length) {
    box.innerHTML = `<span class="badge">No numeric features detected</span>`;
    return;
  }
  numericCols.forEach((c, i) => {
    const btn = document.createElement("button");
    btn.className = "feature-btn" + (i===0 ? " active" : "");
    btn.textContent = DISPLAY_NAMES[c] || c;
    btn.onclick = () => {
      document.querySelectorAll(".feature-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      renderDistributions(RAW, c);
    };
    box.appendChild(btn);
  });
}

function renderDistributions(rows, col) {
  const vals = rows.map(r => toNum(r[col])).filter(v => Number.isFinite(v));
  if (vals.length === 0) {
    drawEmptyDist(`No numeric values for "${col}"`);
    return;
  }

  const n = vals.length;
  vals.sort((a,b)=>a-b);
  const min = vals[0], max = vals[vals.length-1];
  const k = clamp(Math.round(Math.log2(n) + 1), 5, 30);
  const binSize = (max - min) / k || 1;
  const edges = Array.from({length: k+1}, (_,i)=> min + i*binSize);
  const counts = new Array(k).fill(0);
  for (const v of vals) {
    let idx = Math.floor((v - min) / binSize);
    if (idx >= k) idx = k-1;
    if (idx < 0) idx = 0;
    counts[idx]++;
  }
  const labels = counts.map((_,i)=> `${roundPretty(edges[i])}–${roundPretty(edges[i+1])}`);

  const ctx = document.getElementById("distChart").getContext("2d");
  if (CHARTS.dist) CHARTS.dist.destroy();
  CHARTS.dist = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets: [{ label: (DISPLAY_NAMES[col]||col), data: counts }] },
    options: {
      responsive: true,
      plugins: { legend: { display: true } },
      scales: { x: { ticks: { maxRotation: 0, autoSkip: true } }, y: { beginAtZero: true } }
    }
  });
}

function drawEmptyDist(msg) {
  const ctx = document.getElementById("distChart").getContext("2d");
  if (CHARTS.dist) CHARTS.dist.destroy();
  CHARTS.dist = new Chart(ctx, {
    type: "bar",
    data: { labels: [""], datasets: [{ label: msg, data: [0] }] },
    options: { plugins: { legend: { display: true } } }
  });
}

function roundPretty(x) {
  if (!Number.isFinite(x)) return x;
  if (Math.abs(x) >= 1000) return Math.round(x);
  if (Math.abs(x) >= 100) return Math.round(x * 10) / 10;
  if (Math.abs(x) >= 10) return Math.round(x * 100) / 100;
  return Math.round(x * 1000) / 1000;
}

/* ============================
   Correlations (table heatmap)
=============================*/

function renderCorrelations(rows, numericCols) {
  const container = document.getElementById("corrContainer");
  if (!numericCols.length) {
    container.innerHTML = `<div class="badge">No numeric features for correlation</div>`;
    return;
  }

  const matrix = {};
  const cols = numericCols;
  cols.forEach(c => { matrix[c] = {}; });

  for (let i=0;i<cols.length;i++) {
    for (let j=0;j<cols.length;j++) {
      const a = cols[i], b = cols[j];
      matrix[a][b] = pearson(rows, a, b);
    }
  }

  let html = `<div class="card"><table class="corr-table"><thead><tr><th></th>`;
  html += cols.map(c => `<th>${DISPLAY_NAMES[c] || c}</th>`).join("");
  html += `</tr></thead><tbody>`;

  for (const rC of cols) {
    html += `<tr><th>${DISPLAY_NAMES[rC] || rC}</th>`;
    for (const cC of cols) {
      const v = matrix[rC][cC];
      const bg = corrColor(v);
      const txt = Number.isFinite(v) ? (Math.round(v*100)/100).toFixed(2) : "—";
      html += `<td style="background:${bg};">${txt}</td>`;
    }
    html += `</tr>`;
  }
  html += `</tbody></table></div>`;

  container.innerHTML = html;
}

function pearson(rows, colA, colB) {
  const pairs = [];
  for (const r of rows) {
    const a = toNum(r[colA]);
    const b = toNum(r[colB]);
    if (Number.isFinite(a) && Number.isFinite(b)) pairs.push([a,b]);
  }
  const n = pairs.length;
  if (n < 3) return NaN;
  const xs = pairs.map(p => p[0]);
  const ys = pairs.map(p => p[1]);
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i=0;i<n;i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    num += dx*dy; dx2 += dx*dx; dy2 += dy*dy;
  }
  const den = Math.sqrt(dx2*dy2);
  if (den === 0) return NaN;
  return clamp(num/den, -1, 1);
}

function mean(arr) { return arr.reduce((a,b)=>a+b, 0) / arr.length; }

function corrColor(r) {
  if (!Number.isFinite(r)) return "transparent";
  const g = r > 0 ? Math.round(255 * r) : 0;
  const red = r < 0 ? Math.round(255 * Math.abs(r)) : 0;
  const alpha = 0.25 + 0.45 * Math.abs(r);
  return `rgba(${red}, ${g}, 0, ${alpha})`;
}

/* ============================
   Players (Top N & Win Rates)
=============================*/

function renderPlayers(rows) {
  const cnt = {};
  const wins = {};

  rows.forEach(r => {
    const p1 = (r.Player_1 || r.player_1 || r.player1 || "").toString();
    const p2 = (r.Player_2 || r.player_2 || r.player2 || "").toString();
    if (p1) { cnt[p1] = (cnt[p1] || 0) + 1; }
    if (p2) { cnt[p2] = (cnt[p2] || 0) + 1; }

    let winner = r.Winner || r.winner || "";
    let y = r.y;
    if (y !== undefined && y !== null && String(y).trim() !== "") {
      const yNum = toNum(y);
      if (Number.isFinite(yNum)) {
        if (yNum === 1 && p1) wins[p1] = (wins[p1] || 0) + 1;
        if (yNum === 0 && p2) wins[p2] = (wins[p2] || 0) + 1;
      }
    } else if (winner) {
      winner = String(winner);
      if (winner === p1) wins[p1] = (wins[p1] || 0) + 1;
      if (winner === p2) wins[p2] = (wins[p2] || 0) + 1;
    }
  });

  const players = Object.keys(cnt);
  if (players.length === 0) { drawEmptyPlayers(); return; }

  const top = players.map(p => ({p, matches: cnt[p], wins: wins[p] || 0}))
                     .sort((a,b)=>b.matches - a.matches)
                     .slice(0, 10);

  const ctx1 = document.getElementById("topPlayersChart").getContext("2d");
  if (CHARTS.topPlayers) CHARTS.topPlayers.destroy();
  CHARTS.topPlayers = new Chart(ctx1, {
    type: "bar",
    data: { labels: top.map(t=>t.p), datasets: [{ label: "Matches", data: top.map(t=>t.matches) }] },
    options: { responsive: true, plugins: { legend: { display: true } }, scales: { y: { beginAtZero: true } } }
  });

  const ctx2 = document.getElementById("winRatePlayersChart").getContext("2d");
  if (CHARTS.winRatePlayers) CHARTS.winRatePlayers.destroy();
  CHARTS.winRatePlayers = new Chart(ctx2, {
    type: "bar",
    data: {
      labels: top.map(t=>t.p),
      datasets: [{ label: "Win rate, %", data: top.map(t=> t.matches ? Math.round((t.wins / t.matches) * 1000)/10 : 0) }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: true } },
      scales: { y: { beginAtZero: true, ticks: { callback: v => v + "%" } } }
    }
  });
}

function drawEmptyPlayers() {
  const c1 = document.getElementById("topPlayersChart").getContext("2d");
  if (CHARTS.topPlayers) CHARTS.topPlayers.destroy();
  CHARTS.topPlayers = new Chart(c1, {
    type: "bar",
    data: { labels: [""], datasets: [{ label: "No player data", data: [0] }] }
  });

  const c2 = document.getElementById("winRatePlayersChart").getContext("2d");
  if (CHARTS.winRatePlayers) CHARTS.winRatePlayers.destroy();
  CHARTS.winRatePlayers = new Chart(c2, {
    type: "bar",
    data: { labels: [""], datasets: [{ label: "No player data", data: [0] }] }
  });
}
