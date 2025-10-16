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
  return NUMERIC_HINTS.includes(low) || /(\d|rank|pts|odd|year|diff|winrate)/i.test(low);
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
   Init (CSV loading)
=============================*/

function init() {
  const csvFile = "wta_data.csv"; // 👈 убедись, что это имя твоего файла
  const delimiters = [",", ";", "\t"];
  let loaded = false;

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

  // Если не загрузилось — показать сообщение
  setTimeout(() => {
    if (!loaded) {
      showDatasetInfo(`
        ⚠️ <b>Failed to load CSV file.</b><br>
        Please ensure:
        <ul style="text-align:left;display:inline-block;">
          <li>The file <code>${csvFile}</code> is in the same folder as <code>index.html</code>.</li>
          <li>You are running the project via a local server (e.g. <code>python -m http.server</code>).</li>
        </ul>
      `);
    }
  }, 2000);
}

// стартуем после загрузки страницы
document.addEventListener("DOMContentLoaded", init);

/* ============================
   CSV handling
=============================*/

function onCsvLoaded(results) {
  const { data, meta } = results || {};
  if (!Array.isArray(data) || data.length === 0) {
    showDatasetInfo("⚠️ CSV loaded, but empty.");
    return;
  }

  const cols = (meta && meta.fields) ? meta.fields : Object.keys(data[0] || {});
  const cleaned = data.filter(row =>
    cols.some(c => row[c] !== null && row[c] !== undefined && String(row[c]).trim() !== "")
  );

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
  renderDistributions(derived, NUMERIC_COLS[0]);
  renderCorrelations(derived, NUMERIC_COLS);
  renderPlayers(derived);
}

/* ============================
   Derived Columns
=============================*/

function addDerivedColumns(rows) {
  const haveYear = rows.some(r => "year" in r);
  return rows.map(r => {
    const out = { ...r };
    const dateVal = out.Date ?? out.date;
    if (!haveYear) {
      const yr = parseDateToYear(dateVal);
      if (!isNaN(yr)) out.year = yr;
    }
    if (!("rank_diff" in out)) {
      const r1 = toNum(out.Rank_1 ?? out.rank_1);
      const r2 = toNum(out.Rank_2 ?? out.rank_2);
      if (!isNaN(r1) && !isNaN(r2)) out.rank_diff = r2 - r1;
    }
    if (!("pts_diff" in out)) {
      const p1 = toNum(out.Pts_1 ?? out.pts_1);
      const p2 = toNum(out.Pts_2 ?? out.pts_2);
      if (!isNaN(p1) && !isNaN(p2)) out.pts_diff = p1 - p2;
    }
    if (!("odd_diff" in out)) {
      const o1 = toNum(out.Odd_1 ?? out.odd_1);
      const o2 = toNum(out.Odd_2 ?? out.odd_2);
      if (!isNaN(o1) && !isNaN(o2)) out.odd_diff = o2 - o1;
    }
    return out;
  });
}

/* ============================
   Dataset Overview
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
  const html = `
    ✅ <strong>File loaded:</strong> wta_data_features.csv<br>
    <strong>Rows:</strong> ${nRows}, <strong>Columns:</strong> ${cols.length}<br>
    <strong>Years:</strong> ${yMin}–${yMax}<br>
    <strong>Numeric features:</strong> ${NUMERIC_COLS.join(", ")}
  `;
  showDatasetInfo(html);
}

/* ============================
   Missing Values
=============================*/

function renderMissingness(rows) {
  const cols = uniq(rows.flatMap(r => Object.keys(r)));
  const stats = cols.map(c => {
    let miss = 0, total = rows.length;
    for (const r of rows) {
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
    options: { responsive: true, plugins: { legend: { display: true } }, scales: { y: { beginAtZero: true } } }
  });
}

/* ============================
   Distributions
=============================*/

function buildFeatureButtons(numericCols) {
  const box = document.getElementById("featureButtons");
  box.innerHTML = "";
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
  const ctx = document.getElementById("distChart").getContext("2d");
  if (CHARTS.dist) CHARTS.dist.destroy();
  if (vals.length < 5) {
    CHARTS.dist = new Chart(ctx, { type: "bar", data: { labels: [""], datasets: [{ label: "No data", data: [0] }] } });
    return;
  }

  const n = vals.length;
  vals.sort((a,b)=>a-b);
  const min = vals[0], max = vals[n-1];
  const bins = 25;
  const step = (max - min) / bins;
  const hist = Array(bins).fill(0);
  vals.forEach(v => {
    let i = Math.floor((v - min) / step);
    if (i >= bins) i = bins - 1;
    hist[i]++;
  });

  const labels = Array.from({length: bins}, (_,i)=> (min + i*step).toFixed(2));
  CHARTS.dist = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets: [{ label: DISPLAY_NAMES[col] || col, data: hist }] },
    options: { responsive: true, plugins: { legend: { display: true } } }
  });
}

/* ============================
   Correlations
=============================*/

function renderCorrelations(rows, numericCols) {
  const container = document.getElementById("corrContainer");
  if (!numericCols.length) {
    container.innerHTML = `<div>No numeric features.</div>`;
    return;
  }

  const matrix = {};
  numericCols.forEach(a => { matrix[a] = {}; numericCols.forEach(b => { matrix[a][b] = pearson(rows,a,b); }); });

  let html = `<table class='corr-table'><tr><th></th>${numericCols.map(c=>`<th>${c}</th>`).join("")}</tr>`;
  for (const a of numericCols) {
    html += `<tr><th>${a}</th>`;
    for (const b of numericCols) {
      const v = matrix[a][b];
      const bg = corrColor(v);
      const val = Number.isFinite(v) ? v.toFixed(2) : "—";
      html += `<td style='background:${bg}'>${val}</td>`;
    }
    html += "</tr>";
  }
  html += "</table>";
  container.innerHTML = html;
}

function pearson(rows, a, b) {
  const x = [], y = [];
  rows.forEach(r => {
    const xv = toNum(r[a]), yv = toNum(r[b]);
    if (Number.isFinite(xv) && Number.isFinite(yv)) { x.push(xv); y.push(yv); }
  });
  const n = x.length;
  if (n < 3) return NaN;
  const mx = mean(x), my = mean(y);
  const num = x.reduce((s,_,i)=>s+(x[i]-mx)*(y[i]-my),0);
  const den = Math.sqrt(x.reduce((s,v)=>s+(v-mx)**2,0)*y.reduce((s,v)=>s+(v-my)**2,0));
  return den ? num/den : NaN;
}

function mean(a){return a.reduce((x,y)=>x+y,0)/a.length;}
function corrColor(r){if(!Number.isFinite(r))return"transparent";const red=r<0?255*Math.abs(r):0;const green=r>0?255*r:0;return`rgba(${red},${green},0,${0.3+Math.abs(r)*0.5})`;}

/* ============================
   Players
=============================*/

function renderPlayers(rows) {
  const stats = {};
  rows.forEach(r => {
    const p1 = r.Player_1 || r.player_1, p2 = r.Player_2 || r.player_2;
    if (p1) { stats[p1] = stats[p1] || { matches:0, wins:0 }; stats[p1].matches++; if (r.y==1) stats[p1].wins++; }
    if (p2) { stats[p2] = stats[p2] || { matches:0, wins:0 }; stats[p2].matches++; if (r.y==0) stats[p2].wins++; }
  });

  const top = Object.entries(stats).sort((a,b)=>b[1].matches-a[1].matches).slice(0,10);
  const names = top.map(([n])=>n);
  const matches = top.map(([_,v])=>v.matches);
  const winrates = top.map(([_,v])=>Math.round((v.wins/v.matches)*1000)/10);

  const ctx1 = document.getElementById("topPlayersChart").getContext("2d");
  if (CHARTS.topPlayers) CHARTS.topPlayers.destroy();
  CHARTS.topPlayers = new Chart(ctx1,{type:"bar",data:{labels:names,datasets:[{label:"Matches",data:matches}]}});

  const ctx2 = document.getElementById("winRatePlayersChart").getContext("2d");
  if (CHARTS.winRatePlayers) CHARTS.winRatePlayers.destroy();
  CHARTS.winRatePlayers = new Chart(ctx2,{type:"bar",data:{labels:names,datasets:[{label:"Winrate %",data:winrates}]}});

}
