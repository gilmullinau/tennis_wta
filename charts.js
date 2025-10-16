document.addEventListener("DOMContentLoaded", () => {
  Papa.parse("wta_data.csv", {
    download: true,
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
    delimiter: ";", // 🔹 Жёстко указываем точку с запятой
    transformHeader: h => h.trim().replace(/^﻿/, ""), // Убираем BOM
    complete: function (results) {
      try {
        const data = results.data.filter(d => d.Date && d.Player_1);
        console.log("✅ Loaded rows:", data.length);
        console.log("Example row:", data[0]);
        if (!data || data.length < 10) {
          showError("⚠️ Dataset not loaded correctly or too few rows.");
          return;
        }
        buildEDA(data);
      } catch (err) {
        console.error("❌ Parsing error:", err);
        showError("❌ Error parsing dataset — check console.");
      }
    },
    error: function (err) {
      console.error("PapaParse Error:", err);
      showError("❌ Cannot load wta_data.csv — check if file exists.");
    }
  });
});

function showError(msg) {
  document.querySelector("main").innerHTML = `
  <div style="background:#2c2c2c;color:#ffb3b3;border:1px solid #ff6b6b;
  padding:1.5rem;margin:2rem;border-radius:10px;text-align:center;">${msg}</div>`;
}

function buildEDA(data) {
  // === Dataset summary ===
  const totalMatches = data.length;
  const years = [...new Set(data.map(d => d.year || new Date(d.Date).getFullYear()))].filter(y => !isNaN(y));
  const players = new Set(data.flatMap(d => [d.Player_1, d.Player_2]));
  const favWins = data.filter(d => d.y === 1).length;

  document.getElementById("datasetInfo").innerHTML = `
    Dataset contains <strong>${totalMatches.toLocaleString()}</strong> matches 
    from <strong>${Math.min(...years)}</strong> to <strong>${Math.max(...years)}</strong>,
    involving <strong>${players.size}</strong> unique players.<br>
    Favourites won <strong>${(favWins / totalMatches * 100).toFixed(1)}%</strong> of matches.
  `;

  // === Overview: Missing values per column ===
  const cols = Object.keys(data[0]);
  const missing = cols.map(c => data.filter(d => d[c] === null || d[c] === "" || d[c] === undefined).length);

  new Chart(document.getElementById("missingChart"), {
    type: "bar",
    data: {
      labels: cols,
      datasets: [{
        label: "Missing values",
        data: missing,
        backgroundColor: "#58a6ff"
      }]
    },
    options: { plugins: { legend: { display: false } }, scales: { x: { ticks: { autoSkip: false } } } }
  });

  // === Distributions ===
  const numeric = ["Rank_1","Rank_2","Pts_1","Pts_2","Odd_1","Odd_2","rank_diff","pts_diff","odd_diff","y"];
  const featureButtons = document.getElementById("featureButtons");
  const distCanvas = document.getElementById("distChart");
  let distChart;

  numeric.forEach(f => {
    const btn = document.createElement("button");
    btn.className = "feature-btn";
    btn.textContent = f;
    btn.onclick = () => {
      document.querySelectorAll(".feature-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const values = data.map(d => +d[f]).filter(v => !isNaN(v));
      plotHistogram(f, values);
    };
    featureButtons.appendChild(btn);
  });

  function plotHistogram(feature, values) {
    if (values.length < 2) return;
    const bins = 30;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const step = (max - min) / bins;
    const hist = Array(bins).fill(0);
    values.forEach(v => {
      let i = Math.floor((v - min) / step);
      if (i >= bins) i = bins - 1;
      hist[i]++;
    });
    const labels = Array.from({ length: bins }, (_, i) => (min + i * step).toFixed(1));
    if (distChart) distChart.destroy();
    distChart = new Chart(distCanvas, {
      type: "bar",
      data: { labels, datasets: [{ data: hist, backgroundColor: "#58a6ff" }] },
      options: { plugins: { legend: { display: false } } }
    });
  }
  document.querySelector(".feature-btn").click();

  // === Correlation matrix ===
  const corrCols = ["Rank_1","Rank_2","Pts_1","Pts_2","Odd_1","Odd_2","rank_diff","pts_diff","odd_diff","y"];
  const corrMatrix = correlationMatrix(data, corrCols);
  document.getElementById("corrContainer").innerHTML = renderCorrTable(corrMatrix, corrCols);

  // === Player stats ===
  const stats = {};
  data.forEach(d => {
    ["Player_1","Player_2"].forEach((key,i)=>{
      const name = d[key];
      if(!name)return;
      if(!stats[name])stats[name]={matches:0,wins:0};
      stats[name].matches++;
      if((i===0&&d.y===1)||(i===1&&d.y===0))stats[name].wins++;
    });
  });

  const top = Object.entries(stats).sort((a,b)=>b[1].matches-a[1].matches).slice(0,10);
  const names = top.map(p=>p[0]);
  const matches = top.map(p=>p[1].matches);
  const winRatesP = top.map(p=>(p[1].wins/p[1].matches*100).toFixed(1));

  new Chart(document.getElementById("topPlayersChart"),{
    type:"bar",
    data:{labels:names,datasets:[{data:matches,backgroundColor:"#58a6ff"}]},
    options:{plugins:{legend:{display:false}}}
  });

  new Chart(document.getElementById("winRatePlayersChart"),{
    type:"bar",
    data:{labels:names,datasets:[{data:winRatesP,backgroundColor:"#3fb950"}]},
    options:{plugins:{legend:{display:false}}}
  });
}

// === Helper functions ===
function correlationMatrix(data, cols) {
  const values = cols.map(c => data.map(d => +d[c]).filter(v => !isNaN(v)));
  return cols.map((_, i) => cols.map((_, j) => pearson(values[i], values[j])));
}
function pearson(x, y) {
  const n = Math.min(x.length, y.length);
  const mx = mean(x), my = mean(y);
  const num = x.reduce((a, _, i) => a + (x[i] - mx) * (y[i] - my), 0);
  const den = Math.sqrt(
    x.reduce((a, v) => a + (v - mx) ** 2, 0) * y.reduce((a, v) => a + (v - my) ** 2, 0)
  );
  return den === 0 ? 0 : num / den;
}
function mean(a) { return a.reduce((x, y) => x + y, 0) / a.length; }
function renderCorrTable(matrix, cols) {
  let html = `<table class='corr-table'><tr><th></th>${cols.map(c => `<th>${c}</th>`).join("")}</tr>`;
  for (let i = 0; i < cols.length; i++) {
    html += `<tr><th>${cols[i]}</th>`;
    for (let j = 0; j < cols.length; j++) {
      const v = matrix[i][j].toFixed(2);
      html += `<td style='background-color:${corrColor(v)}'>${v}</td>`;
    }
    html += "</tr>";
  }
  html += "</table>";
  return html;
}
function corrColor(v) {
  const n = parseFloat(v);
  const r = n > 0 ? 40 : 200;
  const g = n > 0 ? 200 : 60;
  const alpha = Math.abs(n) * 0.8 + 0.2;
  return `rgba(${r},${g},100,${alpha})`;
}
