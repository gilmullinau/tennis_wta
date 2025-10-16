// charts.js

Papa.parse("./wta_data.csv", {
  download: true,
  header: true,
  dynamicTyping: true,
  skipEmptyLines: true,
  complete: function (results) {
    const data = results.data.filter(row => Object.keys(row).length > 5);
    console.log(`✅ Loaded ${data.length} rows`);
    buildDashboard(data);
  },
  error: function (err) {
    console.error("❌ Error loading CSV:", err);
    document.getElementById("datasetInfo").innerText = "Error loading dataset. Please check wta_data.csv path.";
  },
});

function buildDashboard(data) {
  if (!data || data.length === 0) {
    document.getElementById("datasetInfo").innerText = "⚠️ No data loaded.";
    return;
  }

  // === Dataset summary info ===
  const cols = Object.keys(data[0]);
  const infoDiv = document.getElementById("datasetInfo");
  infoDiv.innerHTML = `<b>Loaded:</b> ${data.length.toLocaleString()} matches &nbsp; | &nbsp; <b>Columns:</b> ${cols.length}`;

  // === Numeric columns ===
  const numericCols = cols.filter(
    (c) =>
      !isNaN(parseFloat(data[0][c])) &&
      !["y", "year"].includes(c)
  );

  // === Overview: win rate by year ===
  const yearly = {};
  data.forEach((row) => {
    const y = row.year;
    if (!yearly[y]) yearly[y] = { total: 0, wins: 0 };
    yearly[y].total++;
    if (row.y === 1) yearly[y].wins++;
  });

  const years = Object.keys(yearly).sort();
  const winRates = years.map((y) => (yearly[y].wins / yearly[y].total) * 100);

  new Chart(document.getElementById("overviewChart"), {
    type: "line",
    data: {
      labels: years,
      datasets: [
        {
          label: "Win Rate of Favorites (%)",
          data: winRates,
          borderColor: "#2563eb",
          backgroundColor: "#60a5fa55",
          fill: true,
          tension: 0.3,
        },
      ],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, max: 100, title: { display: true, text: "Win rate (%)" } },
        x: { title: { display: true, text: "Year" } },
      },
    },
  });

  // === Feature Distributions ===
  const distContainer = document.getElementById("dist-charts");
  distContainer.innerHTML = "";
  numericCols.forEach((col) => {
    const values = data.map((r) => r[col]).filter((v) => !isNaN(v));
    if (values.length === 0) return;

    const canvas = document.createElement("canvas");
    canvas.height = 200;
    distContainer.appendChild(canvas);

    // binning for histogram effect
    const bins = 20;
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const step = (maxVal - minVal) / bins;
    const counts = Array(bins).fill(0);

    values.forEach((v) => {
      const idx = Math.min(Math.floor((v - minVal) / step), bins - 1);
      counts[idx]++;
    });
    const labels = Array.from({ length: bins }, (_, i) =>
      (minVal + i * step).toFixed(1)
    );

    new Chart(canvas, {
      type: "bar",
      data: {
        labels: labels,
        datasets: [
          {
            label: col,
            data: counts,
            backgroundColor: "#60a5fa",
          },
        ],
      },
      options: {
        plugins: { legend: { display: false } },
        scales: {
          x: { title: { text: col, display: true } },
          y: { beginAtZero: true },
        },
      },
    });
  });

  // === Surface Analysis ===
  const surf = {};
  data.forEach((r) => {
    if (!surf[r.Surface]) surf[r.Surface] = { total: 0, wins: 0 };
    surf[r.Surface].total++;
    if (r.y === 1) surf[r.Surface].wins++;
  });
  const surfaces = Object.keys(surf);
  const surfWin = surfaces.map((s) => (surf[s].wins / surf[s].total) * 100);
  const surfTotal = surfaces.map((s) => surf[s].total);

  new Chart(document.getElementById("surfaceDistChart"), {
    type: "bar",
    data: {
      labels: surfaces,
      datasets: [
        { label: "Matches count", data: surfTotal, backgroundColor: "#818cf8" },
      ],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, title: { display: true, text: "Number of matches" } },
        x: { title: { display: true, text: "Surface type" } },
      },
    },
  });

  new Chart(document.getElementById("surfaceWinChart"), {
    type: "bar",
    data: {
      labels: surfaces,
      datasets: [
        { label: "Win rate (%)", data: surfWin, backgroundColor: "#f472b6" },
      ],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, max: 100, title: { display: true, text: "Win rate (%)" } },
        x: { title: { display: true, text: "Surface type" } },
      },
    },
  });
}
