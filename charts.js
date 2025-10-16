// charts.js — robust loader + improved EDA (tabs kept), no y-by-years, no last chart
document.addEventListener("DOMContentLoaded", () => loadDataThenBuild());

function loadDataThenBuild() {
  // Try with semicolon first, then fallback to comma
  parseCsvWithDelimiter(";")
    .then(data => {
      if (data.length < 10) return parseCsvWithDelimiter(",");
      return data;
    })
    .then(data => {
      if (!data || data.length < 10) {
        showError("⚠️ Dataset not loaded correctly or too few rows.");
        return;
      }
      console.log("✅ Parsed rows:", data.length, "Sample:", data[0]);
      buildEDA(data);
    })
    .catch(err => {
      console.error(err);
      showError("❌ Error parsing dataset.");
    });
}

function parseCsvWithDelimiter(delim) {
  return new Promise((resolve, reject) => {
    Papa.parse("wta_data.csv", {
      download: true,
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      delimiter: delim,
      // normalize headers to lower_snake_case and strip BOM
      transformHeader: h => h
        .replace(/^﻿/, "")            // BOM
        .trim()
        .replace(/\./g, "")
        .replace(/\s+/g, "_")
        .toLowerCase(),
      complete: (results) => {
        try {
          // Minimal validity check for our schema
          const rows = results.data.filter(d => d.date && (d.player_1 || d.player1));
          resolve(rows);
        } catch (e) {
          reject(e);
        }
      },
      error: (e) => reject(e)
    });
  });
}

function showError(msg) {
  document.querySelector("main").innerHTML = `
  <div style="background:#2c2c2c;color:#ffb3b3;border:1px solid #ff6b6b;
  padding:1.5rem;margin:2rem;border-radius:10px;text-align:center;">${msg}</div>`;
}

function buildEDA(raw) {
  // unify keys (support both player_1 and player1, etc.)
  const data = raw.map(d => ({
    tournament: d.tournament,
    date: d.date,
    court: d.court,
    surface: d.surface,
    round: d.round,
    best_of: d.best_of,
    player_1: d.player_1 ?? d.player1,
    player_2: d.player_2 ?? d.player2,
    winner: d.winner,
    rank_1: num(d.rank_1 ?? d.rank1),
    rank_2: num(d.rank_2 ?? d.rank2),
    pts_1: num(d.pts_1 ?? d.pts1),
    pts_2: num(d.pts_2 ?? d.pts2),
    odd_1: num(d.odd_1 ?? d.odd1),
    odd_2: num(d.odd_2 ?? d.odd2),
    score: d.score,
    y: num(d.y),
    year: num(d.year),
    rank_diff: num(d.rank_diff),
    pts_diff: num(d.pts_diff),
    odd_diff: num(d.odd_diff)
  }));

  // === Dataset summary
  const totalMatches = data.length;
  const yearsArr = unique(
    data.map(x => x.year || (x.date ? new Date(x.date).getFullYear() : null))
  ).filter(y => !isNaN(y));
  const players = new Set(data.flatMap(x => [x.player_1, x.player_2]).filter(Boolean));
  const favWins = data.filter(x => x.y === 1).length;

  const minYear = Math.min(...yearsArr);
  const maxYear = Math.max(...yearsArr);
  document.getElementById("datasetInfo").innerHTML = `
    Dataset contains <strong>${fmt(totalMatches)}</strong> matches 
    from <strong>${isFinite(minYear)?minYear:"?"}</strong> to <strong>${isFinite(maxYear)?maxYear:"?"}</strong>,
    involving <strong>${fmt(players.size)}</strong> unique players.<br>
    Favourites won <strong>${isFinite(favWins)?(favWins / totalMatches * 100).toFixed(1):"?"}%</strong> of matches.
  `;

  // === Overview: Missing values per column
  const cols = Object.keys(data[0] ?? {});
  const missing = cols.map(c => data.reduce((acc, r) => acc + (r[c] === null || r[c] === "" || typeof r[c] === "undefined" ? 1 : 0), 0));
  if (document.getElementById("missingChart")) {
    new Chart(document.getElementById("missingChart"), {
      type: "bar",
      data: { labels: cols, datasets: [{ label: "Missing values", data: missing, backgroundColor: "#58a6ff" }] },
      options: { plugins: { legend: { display: false } }, scales: { x: { ticks: { autoSkip: false } } } }
    });
  }

  // === Distributions
  const numericCandidates = ["rank_1","rank_2","pts_1","pts_2","odd_1","odd_2","rank_diff","pts_diff","odd_diff","y"];
  const numeric = numericCandidates.filter(c => data.some(x => isFinite(x[c])));
  const featureButtons = document.getElementById("featureButtons");
  const distCanvas = document.getElementById("distChart");
  let distChart;

  featureButtons.innerHTML = "";
  numeric.forEach(f => {
    const btn = document.createElement("button");
    btn.className = "feature-btn";
    btn.textContent = f;
    btn.onclick = () => {
      document.querySelectorAll(".feature-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const values = data.map(d => d[f]).filter(v => isFinite(v));
      plotHistogram(f, values);
    };
    featureButtons.appendChild(btn);
  });

  function plotHistogram(feature, values) {
    if (!values || values.length < 2) return;
    const bins = Math.min(40, Math.max(10, Math.round(Math.sqrt(values.length))));
    const min = Math.min(...values), max = Math.max(...values);
    const step = (max - min) / bins || 1;
    const hist = Array(bins).fill(0);
    values.forEach(v => {
      let i = Math.floor((v - min) / step);
      if (i < 0) i = 0;
      if (i >= bins) i = bins - 1;
      hist[i]++;
    });
    const labels = Array.from({ length: bins }, (_, i) => (min + i * step).toFixed(2));
    if (distChart) distChart.destroy();
    distChart = new Chart(distCanvas, {
      type: "bar",
      data: { labels, datasets: [{ data: hist, label: `${feature} distribution`, backgroundColor: "#58a6ff" }] },
      options: { plugins: { legend: { display: false } } }
    });
  }
  // click first available feature
  const firstBtn = document.querySelector(".feature-btn");
  if (firstBtn) firstBtn.click();

  // === Correlation matrix (expanded)
  const corrCols = numeric; // все доступные числовые
  const corrMatrix = correlationMatrix(data, corrCols);
  document.getElementById("corrContainer").innerHTML = renderCorrTable(corrMatrix, corrCols);

  // === Players: top by matches + win rate
  const stats = {};
  data.forEach(d => {
    ["player_1","player_2"].forEach((key,i)=>{
      const name = d[key];
      if(!name) return;
      if(!stats[name]) stats[name] = {matches:0,wins:0};
      stats[name].matches++;
      if((i===0 && d.y===1) || (i===1 && d.y===0)) stats[name].wins++;
    });
  });
  const top = Object.entries(stats).sort((a,b)=>b[1].matches-a[1].matches).slice(0,10);
  const names = top.map(p=>p[0]);
  const matches = top.map(p=>p[1].matches);
  const winRatesP = top.map(p=> (p[1].wins/p[1].matches*100).toFixed(1));

  if (document.getElementById("topPlayersChart")) {
    new Chart(document.getElementById("topPlayersChart"),{
      type:"bar",
      data:{labels:names,datasets:[{data:matches,backgroundColor:"#58a6ff"}]},
      options:{plugins:{legend:{display:false}}}
    });
  }
  if (document.getElementById("winRatePlayersChart")) {
    new Chart(document.getElementById("winRatePlayersChart"),{
      type:"bar",
      data:{labels:names,datasets:[{data:winRatesP,backgroundColor:"#3fb950"}]},
      options:{plugins:{legend:{display:false}}}
    });
  }
}

/* === Helpers === */
function unique(a){return Array.from(new Set(a));}
function fmt(x){return (x??0).toLocaleString();}
function num(v){const n=Number(v);return Number.isFinite(n)?n:NaN;}

function correlationMatrix(data, cols) {
  const series = cols.map(c => data.map(d => d[c]).filter(v => isFinite(v)));
  const n = cols.length, M = Array.from({length:n},()=>Array(n).fill(0));
  for (let i=0;i<n;i++){
    for (let j=0;j<n;j++){
      M[i][j] = pearson(series[i], series[j]);
    }
  }
  return M;
}
function pearson(x, y) {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;
  const mx = mean(x), my = mean(y);
  let num = 0, dx = 0, dy = 0;
  for (let i=0;i<n;i++){
    const a = x[i]-mx, b = y[i]-my;
    num += a*b; dx += a*a; dy += b*b;
  }
  const den = Math.sqrt(dx*dy);
  return den===0 ? 0 : num/den;
}
function mean(a){return a.reduce((s,v)=>s+v,0)/a.length;}
function renderCorrTable(matrix, cols){
  let html = `<table class='corr-table'><tr><th></th>${cols.map(c=>`<th>${c}</th>`).join("")}</tr>`;
  for(let i=0;i<cols.length;i++){
    html += `<tr><th>${cols[i]}</th>`;
    for(let j=0;j<cols.length;j++){
      const v = (matrix[i][j]??0).toFixed(2);
      html += `<td style='background-color:${corrColor(v)}'>${v}</td>`;
    }
    html += `</tr>`;
  }
  html += `</table>`;
  return html;
}
function corrColor(v){
  const n = parseFloat(v);
  const r = n > 0 ? 40 : 200;
  const g = n > 0 ? 200 : 60;
  const alpha = Math.abs(n)*0.8 + 0.2;
  return `rgba(${r},${g},100,${alpha})`;
}
