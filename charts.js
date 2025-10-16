// charts.js — basic version for Overview tab

Papa.parse("./wta_data.csv", {
  download: true,
  header: true,
  dynamicTyping: true,
  skipEmptyLines: true,
  complete: function (results) {
    const data = results.data.filter(r => r && Object.keys(r).length > 5);
    console.log(`✅ Loaded ${data.length} rows`);
    buildOverview(data);
  },
  error: function (err) {
    console.error("❌ Error loading CSV:", err);
    document.getElementById("datasetInfo").innerText = "Error loading dataset. Check path or file format.";
  },
});

function buildOverview(data) {
  // === Проверка данных ===
  if (!data || data.length === 0) {
    document.getElementById("datasetInfo").innerText = "⚠️ No data loaded.";
    return;
  }

  const cols = Object.keys(data[0]);
  const years = data.map(d => d.year).filter(y => !isNaN(y));
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);

  // === Обновляем информационный блок ===
  document.getElementById("datasetInfo").innerHTML = `
    <b>Loaded:</b> ${data.length.toLocaleString()} matches |
    <b>Columns:</b> ${cols.length} |
    <b>Years:</b> ${minYear} – ${maxYear}
  `;

  // === Строим Win Rate по годам ===
  const yearly = {};
  data.forEach(row => {
    const y = row.year;
    if (!y) return;
    if (!yearly[y]) yearly[y] = { total: 0, wins: 0 };
    yearly[y].total++;
    if (row.y === 1) yearly[y].wins++;
  });

  const sortedYears = Object.keys(yearly).sort();
  const winRates = sortedYears.map(y => (yearly[y].wins / yearly[y].total) * 100);

  const ctx = document.getElementById("overviewChart");
  new Chart(ctx, {
    type: "line",
    data: {
      labels: sortedYears,
      datasets: [
        {
          label: "Favorites Win Rate (%)",
          data: winRates,
          borderColor: "#2563eb",
          backgroundColor: "#60a5fa55",
          tension: 0.3,
          fill: true,
        },
      ],
    },
    options: {
      plugins: {
        title: {
          display: true,
          text: "Win Rate of Favorites by Year (%)",
          font: { size: 16 },
        },
        legend: { display: false },
      },
      scales: {
        x: { title: { display: true, text: "Year" } },
        y: {
          title: { display: true, text: "Win Rate (%)" },
          beginAtZero: true,
          max: 100,
        },
      },
    },
  });
}

