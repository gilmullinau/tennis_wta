// charts.js — robust EDA for WTA dashboard (Chart.js + PapaParse only, updated for advanced features)

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
  rank_diff: "Rank Diff", pts_diff: "Pts Diff", odd_diff: "Odd Diff",
  h2h_advantage: "H2H Advantage",
  last_winner: "Last Winner",
  surface_winrate_adv: "Surface Winrate Advantage",
  y: "Target (y)",
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
  return NUMERIC_HINTS.includes(low) || /(\d|rank|pts|odd|year|diff|advantage|winner)/i.test(low);
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

function uniq(arr) {
  return [...new Set(arr)];
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

/* ============================
   State
=============================*/

let RAW = [];
let NUMERIC_COLS = [];
let CHARTS = {
  missing: null,
  dist: null,
  topPlayers: null,
  winRatePlayers: null
};

/* ============================
   Bootstrap
=============================*/

init();

function init() {
  const csvPath = "wta_data_features.csv"; // updated dataset with engineered features
  Papa.parse(csvPath, {
    download: true,
    header: true,
    dynamicTyping: false,
    skipEmptyLines: "greedy",
    complete: onCsvLoaded,
    error: (err) => {
      showDatasetInfo(`⚠️ Не удалось загрузить CSV (${err?.message || "unknown error"}). Проверь, что файл называется "wta_data_features.csv" и лежит рядом с index.html`);
    }
  });
}

/* ============================
   Load & Sanity
=============================*/

function onCsvLoaded(results) {
  const { data, meta } = results || {};
  if (!Array.isArray(data) || data.length === 0) {
    showDatasetInfo("⚠️ CSV загружен, но нет строк данных. Проверь файл.");
    return;
  }

  const cols = (meta && meta.fields) ? meta.fields : Object.keys(data[0] || {});
  const cleaned = data.filter(row =>
    cols.some(c => (row[c] !== null && row[c] !== undefined && String(row[c]).trim() !== ""))
  );

  if (cleaned.length === 0) {
    showDatasetInfo("⚠️ В файле только пустые строки или заголовки без данных.");
    return;
  }

  const norm = cleaned.map(row => {
    const r = {};
    for (const k of Object.keys(row)) r[k.trim()] = row[k];
    return r;
  });

  RAW = addDerivedColumns(norm);
  NUMERIC_COLS = detectNumericColumns(RAW);

  renderDatasetOverview(RAW);
  renderMissingness(RAW);
  buildFeatureButtons(NUMERIC_COLS);
  renderDistributions(RAW, NUMERIC_COLS[0]);
  renderCorrelations(RAW, NUMERIC_COLS);
  renderPlayers(RAW);
}

/* ============================
   Derived columns
=============================*/

function addDerivedColumns(rows) {
  return rows.map(r => {
    const out = { ...r };

    out.Player_1 = out.Player_1 ?? out.player_1 ?? out.P1 ?? out.p1;
    out.Player_2 = out.Player_2 ?? out.player_2 ?? out.P2 ?? out.p2;
    out.Rank_1 = out.Rank_1 ?? out.rank_1;
    out.Rank_2 = out.Rank_2 ?? out.rank_2;
    out.Pts_1 = out.Pts_1 ?? out.pts_1;
    out.Pts_2 = out.Pts_2 ?? out.pts_2;
    out.Odd_1 = out.Odd_1 ?? out.odd_1;
    out.Odd_2 = out.Odd_2 ?? out.odd_2;
    out.y = out.y ?? out.target ?? out.win ?? out.Won ?? out.won;

    if (!("year" in out)) {
      const yr = parseDateToYear(out.Date);
      if (!isNaN(yr)) out.year = yr;
    }

    // Derived numeric features if missing
    if (!("rank_diff" in out)) out.rank_diff = toNum(out.Rank_2) - toNum(out.Rank_1);
    if (!("pts_diff" in out)) out.pts_diff = toNum(out.Pts_1) - toNum(out.Pts_2);
    if (!("odd_diff" in out)) out.odd_diff = toNum(out.Odd_2) - toNum(out.Odd_1);

    // Safety for engineered columns
    out.h2h_advantage = toNum(out.h2h_advantage ?? 0);
    out.last_winner = toNum(out.last_winner ?? 0);
    out.surface_winrate_adv = toNum(out.surface_winrate_adv ?? 0);

    return out;
  });
}

/* ============================
   Column typing
=============================*/

function detectNumericColumns(rows) {
  const sample = rows.slice(0, Math.min(300, rows.length));
  const cols = uniq(sample.flatMap(r => Object.keys(r)));
  const numericCols = [];

  for (const c of cols) {
    let nCount = 0, seen = 0;
    for (const r of sample) {
      const v = r[c];
      if (v === "" || v === null || v === undefined) continue;
      seen++;
      if (Number.isFinite(toNum(v))) nCount++;
    }
    if (seen > 0 && nCount / seen >= 0.7 && isLikelyNumericCol(c)) numericCols.push(c);
  }

  if (!numericCols.includes("y") && rows.some(r => r.y !== undefined)) numericCols.push("y");

  // Ensure new engineered features are included
  ["h2h_advantage", "last_winner", "surface_winrate_adv"].forEach(f => {
    if (rows.some(r => f in r) && !numericCols.includes(f)) numericCols.push(f);
  });

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

  const html = `
    <div><strong>Строк:</strong> ${nRows}, <strong>Колонок:</strong> ${cols.length}</div>
    <div><strong>Годы:</strong> ${yMin}–${yMax}</div>
    <div><strong>Числовые признаки:</strong> ${NUMERIC_COLS.join(", ")}</div>
    <div><strong>Доп. признаки:</strong> h2h_advantage, last_winner, surface_winrate_adv</div>
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
    data: {
      labels: stats.map(s => s.col),
      datasets: [{ label: "% пропусков", data: stats.map(s => s.missPct) }]
    },
    options: { responsive: true, scales: { y: { beginAtZero: true } } }
  });
}

/* ============================
   Distributions
=============================*/

function buildFeatureButtons(numericCols) {
  const box = document.getElementById("featureButtons");
  box.innerHTML = "";
  if (!numericCols.length) {
    box.innerHTML = `<span class="badge">Нет числовых признаков для распределений</span>`;
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
  if (!vals.length) return;
  vals.sort((a,b)=>a-b);
  const n = vals.length, bins = clamp(Math.round(Math.log2(n)+1), 5, 30);
  const min = vals[0], max = vals[vals.length-1];
  const step = (max-min)/bins || 1;
  const counts = Array(bins).fill(0);
  vals.forEach(v => {
    let i = Math.floor((v-min)/step);
    if (i>=bins) i=bins-1;
    counts[i]++;
  });
  const labels = Array.from({length:bins},(_,i)=> (min+i*step).toFixed(2));

  const ctx = document.getElementById("distChart").getContext("2d");
  if (CHARTS.dist) CHARTS.dist.destroy();
  CHARTS.dist = new Chart(ctx,{
    type:"bar",
    data:{labels,datasets:[{label:DISPLAY_NAMES[col]||col,data:counts}]},
    options:{responsive:true,scales:{y:{beginAtZero:true}}}
  });
}

/* ============================
   Correlations
=============================*/

function renderCorrelations(rows, cols) {
  const container = document.getElementById("corrContainer");
  const matrix = {};
  cols.forEach(a=>{
    matrix[a]={};
    cols.forEach(b=>{
      matrix[a][b]=pearson(rows,a,b);
    });
  });
  let html=`<table class="corr-table"><thead><tr><th></th>${cols.map(c=>`<th>${DISPLAY_NAMES[c]||c}</th>`).join("")}</tr></thead><tbody>`;
  cols.forEach(a=>{
    html+=`<tr><th>${DISPLAY_NAMES[a]||a}</th>`;
    cols.forEach(b=>{
      const r=matrix[a][b];
      const color=r>0?`rgba(0,200,0,${Math.abs(r)})`:`rgba(200,0,0,${Math.abs(r)})`;
      html+=`<td style="background:${color}">${Number.isFinite(r)?r.toFixed(2):"—"}</td>`;
    });
    html+="</tr>";
  });
  html+="</tbody></table>";
  container.innerHTML=html;
}

function pearson(rows,a,b){
  const arr=rows.map(r=>[toNum(r[a]),toNum(r[b])]).filter(([x,y])=>!isNaN(x)&&!isNaN(y));
  const n=arr.length;
  if(n<5)return 0;
  const mx=arr.reduce((s,[x])=>s+x,0)/n,my=arr.reduce((s,[,y])=>s+y,0)/n;
  const num=arr.reduce((s,[x,y])=>s+(x-mx)*(y-my),0);
  const den=Math.sqrt(arr.reduce((s,[x])=>s+(x-mx)**2,0)*arr.reduce((s,[,y])=>s+(y-my)**2,0));
  return den?num/den:0;
}

/* ============================
   Players
=============================*/

function renderPlayers(rows) {
  const cnt={},wins={};
  rows.forEach(r=>{
    const p1=r.Player_1,p2=r.Player_2,y=toNum(r.y);
    cnt[p1]=(cnt[p1]||0)+1;
    cnt[p2]=(cnt[p2]||0)+1;
    if(y===1)wins[p1]=(wins[p1]||0)+1;
    else if(y===0)wins[p2]=(wins[p2]||0)+1;
  });
  const top=Object.keys(cnt).map(p=>({p,m:cnt[p],w:wins[p]||0}))
      .sort((a,b)=>b.m-a.m).slice(0,10);
  const ctx1=document.getElementById("topPlayersChart").getContext("2d");
  if(CHARTS.topPlayers)CHARTS.topPlayers.destroy();
  CHARTS.topPlayers=new Chart(ctx1,{type:"bar",data:{labels:top.map(x=>x.p),datasets:[{label:"Matches",data:top.map(x=>x.m)}]},options:{scales:{y:{beginAtZero:true}}}});
  const ctx2=document.getElementById("winRatePlayersChart").getContext("2d");
  if(CHARTS.winRatePlayers)CHARTS.winRatePlayers.destroy();
  CHARTS.winRatePlayers=new Chart(ctx2,{type:"bar",data:{labels:top.map(x=>x.p),datasets:[{label:"Win Rate %",data:top.map(x=>x.m?x.w/x.m*100:0)}]},options:{scales:{y:{beginAtZero:true}}}});
}
