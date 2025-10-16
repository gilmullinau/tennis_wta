Papa.parse("wta_data.csv", {
  download: true,
  header: true,
  dynamicTyping: true,
  skipEmptyLines: true,
  complete: function (results) {
    const data = results.data.filter(r => Object.keys(r).length > 5);
    buildDashboard(data);
  },
  error: (err) => console.error("Error loading CSV:", err)
});

function buildDashboard(data) {
  const cols = Object.keys(data[0]);
  document.getElementById("datasetInfo").innerHTML =
    `<b>Loaded:</b> ${data.length.toLocaleString()} matches | <b>Columns:</b> ${cols.length}`;

  // === Overview (win rate by year)
  const yearly = {};
  data.forEach(r => {
    if (!yearly[r.year]) yearly[r.year] = { total: 0, wins: 0 };
    yearly[r.year].total++;
    if (r.y === 1) yearly[r.year].wins++;
  });
  const years = Object.keys(yearly).sort();
  const winRates = years.map(y => (yearly[y].wins / yearly[y].total) * 100);
  new Chart(document.getElementById("overviewChart"), {
    type: "line",
    data: {
      labels: years,
      datasets: [{
        label: "Favorites Win Rate (%)",
        data: winRates,
        borderColor: "#2563eb",
        backgroundColor: "#93c5fd55",
        tension: 0.3,
        fill: true
      }]
    },
    options: { scales: { y: { beginAtZero: true, max: 100 } } }
  });

  // === Distributions (interactive)
  const numericCols = cols.filter(c => !isNaN(parseFloat(data[0][c])) && !["y", "year"].includes(c));
  const select = document.getElementById("featureSelect");
  numericCols.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    select.appendChild(opt);
  });

  let distChart;
  function updateDistChart(col) {
    const values = data.map(r => r[col]).filter(v => !isNaN(v));
    const bins = 20;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const step = (max - min) / bins;
    const counts = Array(bins).fill(0);
    values.forEach(v => {
      const i = Math.min(Math.floor((v - min) / step), bins - 1);
      counts[i]++;
    });
    const labels = Array.from({ length: bins }, (_, i) => (min + i * step).toFixed(1));

    if (distChart) distChart.destroy();
    distChart = new Chart(document.getElementById("distChart"), {
      type: "bar",
      data: {
        labels,
        datasets: [{ label: col, data: counts, backgroundColor: "#60a5fa" }]
      },
      options: { scales: { y: { beginAtZero: true }, x: { title: { display: true, text: col } } } }
    });
  }

  updateDistChart(numericCols[0]);
  select.addEventListener("change", e => updateDistChart(e.target.value));

  // === Correlations (placeholder)
  const ctxCorr = document.getElementById("corrChart").getContext("2d");
  ctxCorr.font = "16px Arial";
  ctxCorr.fillText("📊 Correlation heatmap to be added here", 30, 100);

  // === Players (placeholder)
  const ctxTop = document.getElementById("topPlayersChart").getContext("2d");
  ctxTop.fillText("👩‍🎾 Top players stats to appear here", 30, 80);

  const ctxWin = document.getElementById("winRatePlayersChart").getContext("2d");
  ctxWin.fillText("🏆 Win rate by player - coming soon", 30, 80);

  // === Surfaces
  const surf = {};
  data.forEach(r => {
    if (!surf[r.Surface]) surf[r.Surface] = { total: 0, wins: 0 };
    surf[r.Surface].total++;
    if (r.y === 1) surf[r.Surface].wins++;
  });
  const surfaces = Object.keys(surf);
  const surfCount = surfaces.map(s => surf[s].total);
  const surfWin = surfaces.map(s => (surf[s].wins / surf[s].total) * 100);

  new Chart(document.getElementById("surfaceDistChart"), {
    type: "bar",
    data: {
      labels: surfaces,
      datasets: [{ label: "Matches count", data: surfCount, backgroundColor: "#818cf8" }]
    }
  });

  new Chart(document.getElementById("surfaceWinChart"), {
    type: "bar",
    data: {
      labels: surfaces,
      datasets: [{ label: "Win rate (%)", data: surfWin, backgroundColor: "#f472b6" }]
    },
    options: { scales: { y: { max: 100, beginAtZero: true } } }
  });
}


