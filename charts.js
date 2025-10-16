// charts.js

Papa.parse("./wta_data.csv", {
  download: true,
  header: true,
  dynamicTyping: true,
  complete: function (results) {
    const data = results.data;
    buildDashboard(data);
  },
});

function buildDashboard(data) {
  // Helper: numeric columns
  const numericCols = Object.keys(data[0]).filter(
    (c) =>
      !isNaN(parseFloat(data[0][c])) &&
      !["y", "year"].includes(c)
  );

  // Overview chart — win rate by year
  const yearly = {};
  data.forEach((row) => {
    const y = row.year;
    if (!yearly[y]) yearly[y] = { total: 0, wins: 0 };
    yearly[y].total++;
    if (row.y === 1) yearly[y].wins++;
  });

  const years = Object.keys(yearly);
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
        },
      ],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, max: 100 } },
    },
  });

  // Distributions
  const distContainer = document.getElementById("dist-charts");
  numericCols.forEach((col) => {
    const values = data.map((r) => r[col]).filter((v) => !isNaN(v));
    const canvas = document.createElement("canvas");
    distContainer.appendChild(canvas);
    new Chart(canvas, {
      type: "histogram",
      data: { datasets: [{ label: col, data: values, backgroundColor: "#60a5fa" }] },
      options: {
        plugins: { legend: { display: false } },
        scales: { x: { title: { text: col, display: true } } },
      },
    });
  });

  // Surface Distribution
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
      datasets: [{ label: "Matches count", data: surfTotal, backgroundColor: "#818cf8" }],
    },
  });
  new Chart(document.getElementById("surfaceWinChart"), {
    type: "bar",
    data: {
      labels: surfaces,
      datasets: [{ label: "Win rate (%)", data: surfWin, backgroundColor: "#f472b6" }],
    },
    options: { scales: { y: { beginAtZero: true, max: 100 } } },
  });
}
