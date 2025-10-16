// charts.js – improved EDA dashboard for WTA data
document.addEventListener('DOMContentLoaded', () => {
  Papa.parse("wta_data.csv", {
    download: true,
    header: true,
    dynamicTyping: true,
    complete: function(results) {
      const data = results.data.filter(d => d.Date && d["Player 1"]);
      buildEDA(data);
    }
  });
});

function buildEDA(data) {
  // === Dataset summary ===
  const totalMatches = data.length;
  const years = [...new Set(data.map(d => new Date(d.Date).getFullYear()))].filter(y => !isNaN(y));
  const players = new Set(data.flatMap(d => [d["Player 1"], d["Player 2"]]));
  const favWins = data.filter(d => d.y === 1).length;
  document.getElementById('datasetInfo').innerHTML = `
    Dataset contains <strong>${totalMatches.toLocaleString()}</strong> matches 
    played between <strong>${Math.min(...years)}</strong> and <strong>${Math.max(...years)}</strong>,
    involving <strong>${players.size}</strong> unique players.<br>
    Favourites won <strong>${(favWins / totalMatches * 100).toFixed(1)}%</strong> of matches.
  `;

  // === Overview: favourite win rate by year ===
  const yearly = {};
  data.forEach(d => {
    const year = new Date(d.Date).getFullYear();
    if (!yearly[year]) yearly[year] = { total: 0, wins: 0 };
    yearly[year].total++;
    if (d.y === 1) yearly[year].wins++;
  });
  const yearLabels = Object.keys(yearly);
  const winRates = yearLabels.map(y => (yearly[y].wins / yearly[y].total * 100).toFixed(1));

  new Chart(document.getElementById("overviewChart"), {
    type: "line",
    data: {
      labels: yearLabels,
      datasets: [{
        label: "Favourite Win Rate (%)",
        data: winRates,
        borderColor: "#58a6ff",
        backgroundColor: "rgba(88,166,255,0.2)",
        tension: 0.3,
        fill: true
      }]
    },
    options: { responsive: true, plugins: { legend: { display: false } } }
  });

  // === Distributions: numeric features ===
  const numericFeatures = ["rank_diff", "pts_diff", "odd_diff", "y"];
  const featureButtons = document.getElementById("featureButtons");
  const distChartCanvas = document.getElementById("distChart");
  let distChart;

  numericFeatures.forEach(f => {
    const btn = document.createElement("button");
    btn.classList.add("feature-btn");
    btn.textContent = f;
    btn.onclick = () => {
      document.querySelectorAll(".feature-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const values = data.map(d => parseFloat(d[f])).filter(v => !isNaN(v));
      plotDistribution(f, values);
    };
    featureButtons.appendChild(btn);
  });

  function plotDistribution(feature, values) {
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
    const labels = Array.from({ length: bins }, (_, i) =>
      (min + i * step).toFixed(1)
    );
    if (distChart) distChart.destroy();
    distChart = new Chart(distChartCanvas, {
      type: "bar",
      data: {
        labels,
        datasets: [{
          label: `${feature} distribution`,
          data: hist,
          backgroundColor: "#58a6ff"
        }]
      },
      options: {
        scales: {
          x: { ticks: { color: "#c9d1d9" } },
          y: { ticks: { color: "#c9d1d9" } }
        }
      }
    });
  }

  // Default show first feature
  document.querySelector(".feature-btn").click();

  // === Correlation matrix ===
  const numCols = ["rank_diff", "pts_diff", "odd_diff", "y"];
  const matrix = computeCorrelationMatrix(data, numCols);
  const corrContainer = document.getElementById("corrContainer");
  corrContainer.innerHTML = renderCorrTable(matrix, numCols);

  // === Players section ===
  const playerStats = {};
  data.forEach(d => {
    [1, 2].forEach(i => {
      const name = d[`Player ${i}`];
      if (!playerStats[name]) playerStats[name] = { matches: 0, wins: 0 };
      playerStats[name].matches++;
      if ((i === 1 && d.y === 1) || (i === 2 && d.y === 0)) playerStats[name].wins++;
    });
  });

  const topPlayers = Object.entries(playerStats)
    .sort((a, b) => b[1].matches - a[1].matches)
    .slice(0, 10);
  const names = topPlayers.map(p => p[0]);
  const matches = topPlayers.map(p => p[1].matches);
  const winRatesP = topPlayers.map(p => (p[1].wins / p[1].matches * 100).toFixed(1));

  new Chart(document.getElementById("topPlayersChart"), {
    type: "bar",
    data: {
      labels: names,
      datasets: [{
        label: "Matches played",
        data: matches,
        backgroundColor: "#58a6ff"
      }]
    },
    options: { plugins: { legend: { display: false } } }
  });

  new Chart(document.getElementById("winRatePlayersChart"), {
    type: "bar",
    data: {
      labels: names,
      datasets: [{
        label: "Win rate (%)",
        data: winRatesP,
        backgroundColor: "#3fb950"
      }]
    },
    options: { plugins: { legend: { display: false } } }
  });

  // === Surfaces section ===
  const surfaces = {};
  data.forEach(d => {
    const s = d.Surface || "Unknown";
    if (!surfaces[s]) surfaces[s] = { total: 0, wins: 0 };
    surfaces[s].total++;
    if (d.y === 1) surfaces[s].wins++;
  });
  const surfNames = Object.keys(surfaces);
  const surfTotals = surfNames.map(s => surfaces[s].total);
  const surfWinRates = surfNames.map(s => (surfaces[s].wins / surfaces[s].total * 100).toFixed(1));

  new Chart(document.getElementById("surfaceDistChart"), {
    type: "pie",
    data: {
      labels: surfNames,
      datasets: [{
        data: surfTotals,
        backgroundColor: ["#58a6ff", "#d2a8ff", "#3fb950"]
      }]
    }
  });

  new Chart(document.getElementById("surfaceWinChart"), {
    type: "bar",
    data: {
      labels: surfNames,
      datasets: [{
        label: "Win rate (%)",
        data: surfWinRates,
        backgroundColor: "#3fb950"
      }]
    },
    options: { plugins: { legend: { display: false } } }
  });
}

// === Helper functions ===
function computeCorrelationMatrix(data, cols) {
  const values = cols.map(c => data.map(d => parseFloat(d[c])).filter(v => !isNaN(v)));
  const corr = [];
  for (let i = 0; i < cols.length; i++) {
    corr[i] = [];
    for (let j = 0; j < cols.length; j++) {
      corr[i][j] = pearson(values[i], values[j]);
    }
  }
  return corr;
}

function pearson(x, y) {
  const n = Math.min(x.length, y.length);
  const mx = mean(x.slice(0, n));
  const my = mean(y.slice(0, n));
  const num = x.slice(0, n).reduce((a, _, i) => a + (x[i] - mx) * (y[i] - my), 0);
  const den = Math.sqrt(
    x.slice(0, n).reduce((a, v) => a + (v - mx) ** 2, 0) *
    y.slice(0, n).reduce((a, v) => a + (v - my) ** 2, 0)
  );
  return den === 0 ? 0 : num / den;
}

function mean(a) {
  return a.reduce((x, y) => x + y, 0) / a.length;
}

function renderCorrTable(matrix, cols) {
  let html = `<table class="corr-table"><tr><th></th>${cols.map(c => `<th>${c}</th>`).join("")}</tr>`;
  for (let i = 0; i < cols.length; i++) {
    html += `<tr><th>${cols[i]}</th>`;
    for (let j = 0; j < cols.length; j++) {
      const v = matrix[i][j].toFixed(2);
      const color = correlationColor(v);
      html += `<td style="background-color:${color}">${v}</td>`;
    }
    html += "</tr>";
  }
  html += "</table>";
  return html;
}

function correlationColor(v) {
  const num = parseFloat(v);
  const r = num > 0 ? 50 : 200;
  const g = num > 0 ? 200 : 50;
  const intensity = Math.abs(num) * 0.8 + 0.2;
  return `rgba(${r},${g},100,${intensity})`;
}
