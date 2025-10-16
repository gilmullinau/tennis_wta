/*
 * charts.js
 *
 * This script loads the WTA match dataset using PapaParse and builds interactive
 * charts for each tab in the dashboard: overview, distributions, correlations,
 * player statistics and surfaces. It assumes that wta_data.csv exists in the
 * same directory as index.html. If the file cannot be loaded (e.g. due to
 * browser restrictions when opening index.html directly from the file system),
 * the dataset summary will display an error message.
 */

// Immediately parse the CSV when the page loads
Papa.parse('./wta_data.csv', {
  download: true,
  header: true,
  dynamicTyping: true,
  skipEmptyLines: true,
  complete: function (results) {
    // Filter out empty rows that may appear at the end of the CSV
    const rows = results.data.filter(r => r && Object.keys(r).length > 5);
    if (!rows || rows.length === 0) {
      document.getElementById('datasetInfo').innerText = '⚠️ No data loaded. Check that wta_data.csv is in the same folder.';
      return;
    }
    buildDashboard(rows);
  },
  error: function (err) {
    console.error('Error parsing CSV:', err);
    document.getElementById('datasetInfo').innerText = '❌ Unable to load dataset. Please serve this page via a local web server (e.g. python -m http.server).';
  }
});

function buildDashboard(data) {
  // Determine columns and numeric columns
  const columns = Object.keys(data[0]);
  // Treat any field that parses as a number for the first row as numeric, except y and year
  const numericCols = columns.filter(c => !['y', 'year'].includes(c) && !isNaN(parseFloat(data[0][c])));

  // === Update dataset summary ===
  const years = data.map(d => d.year).filter(y => !isNaN(y));
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);
  document.getElementById('datasetInfo').innerHTML = `
    <strong>Loaded:</strong> ${data.length.toLocaleString()} matches &nbsp;|&nbsp; <strong>Columns:</strong> ${columns.length} &nbsp;|&nbsp; <strong>Years:</strong> ${minYear}–${maxYear}
  `;

  // === Overview chart: Win rate by year ===
  buildOverviewChart(data);

  // === Distributions: create buttons and initial histogram ===
  buildDistribution(data, numericCols);

  // === Correlations: compute and render correlation matrix ===
  buildCorrelations(data, numericCols);

  // === Players: compute stats and render charts ===
  buildPlayers(data);

  // === Surfaces: compute distributions and win rate ===
  buildSurfaces(data);
}

function buildOverviewChart(data) {
  // Aggregate win rate per year
  const yearly = {};
  data.forEach(row => {
    const y = row.year;
    if (!yearly[y]) yearly[y] = { total: 0, wins: 0 };
    yearly[y].total++;
    if (row.y === 1) yearly[y].wins++;
  });
  const sortedYears = Object.keys(yearly).sort((a, b) => a - b);
  const winRates = sortedYears.map(y => (yearly[y].wins / yearly[y].total) * 100);
  // Create line chart
  new Chart(document.getElementById('overviewChart'), {
    type: 'line',
    data: {
      labels: sortedYears,
      datasets: [
        {
          label: 'Favourite win rate (%)',
          data: winRates,
          borderColor: '#58a6ff',
          backgroundColor: 'rgba(88, 166, 255, 0.3)',
          tension: 0.2,
          fill: true,
          pointRadius: 3,
          pointBackgroundColor: '#58a6ff',
          pointHoverRadius: 5
        }
      ]
    },
    options: {
      plugins: {
        title: {
          display: false
        },
        legend: {
          display: false
        }
      },
      scales: {
        x: {
          ticks: { color: '#8b949e' },
          title: { display: true, text: 'Year', color: '#8b949e' },
          grid: { color: 'rgba(255,255,255,0.05)' }
        },
        y: {
          beginAtZero: true,
          max: 100,
          ticks: { color: '#8b949e' },
          title: { display: true, text: 'Win rate (%)', color: '#8b949e' },
          grid: { color: 'rgba(255,255,255,0.05)' }
        }
      }
    }
  });
}

function buildDistribution(data, numericCols) {
  const container = document.getElementById('featureButtons');
  container.innerHTML = '';
  let distChart;
  // Helper to build histogram for a given column
  const drawHistogram = (col) => {
    const values = data.map(r => r[col]).filter(v => typeof v === 'number' && !isNaN(v));
    if (values.length === 0) return;
    const bins = 25;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const step = (max - min) / bins;
    const counts = Array(bins).fill(0);
    values.forEach(v => {
      const idx = Math.min(Math.floor((v - min) / step), bins - 1);
      counts[idx]++;
    });
    const labels = Array.from({ length: bins }, (_, i) => (min + i * step).toFixed(0));
    if (distChart) distChart.destroy();
    distChart = new Chart(document.getElementById('distChart'), {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: col,
            data: counts,
            backgroundColor: 'rgba(88, 166, 255, 0.7)' 
          }
        ]
      },
      options: {
        plugins: { legend: { display: false } },
        scales: {
          x: {
            ticks: { color: '#8b949e', autoSkip: true, maxTicksLimit: 10 },
            title: { display: true, text: col, color: '#8b949e' },
            grid: { color: 'rgba(255,255,255,0.05)' }
          },
          y: {
            ticks: { color: '#8b949e' },
            title: { display: true, text: 'Count', color: '#8b949e' },
            beginAtZero: true,
            grid: { color: 'rgba(255,255,255,0.05)' }
          }
        }
      }
    });
    // highlight selected button
    document.querySelectorAll('.feature-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.feature === col);
    });
  };
  // Create buttons for each numeric column
  numericCols.forEach((col, idx) => {
    const btn = document.createElement('button');
    btn.textContent = col;
    btn.dataset.feature = col;
    btn.className = 'feature-btn';
    btn.addEventListener('click', () => {
      drawHistogram(col);
    });
    container.appendChild(btn);
    // by default choose the first numeric column
    if (idx === 0) {
      btn.classList.add('active');
      setTimeout(() => drawHistogram(col), 0);
    }
  });
}

function buildCorrelations(data, numericCols) {
  // Limit the number of features for correlation matrix to avoid excessive width
  const maxCols = 10;
  const features = numericCols.slice(0, maxCols);
  // Precompute values per feature
  const values = {};
  features.forEach(f => {
    values[f] = data.map(r => r[f]).filter(v => typeof v === 'number' && !isNaN(v));
  });
  // Compute means and standard deviations
  const stats = {};
  features.forEach(f => {
    const arr = values[f];
    const n = arr.length;
    const mean = arr.reduce((a, b) => a + b, 0) / n;
    const std = Math.sqrt(arr.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / n);
    stats[f] = { mean, std };
  });
  // Compute correlation matrix
  const corr = {};
  features.forEach(f1 => {
    corr[f1] = {};
    features.forEach(f2 => {
      if (f1 === f2) {
        corr[f1][f2] = 1;
      } else {
        // compute covariance
        const arr1 = values[f1];
        const arr2 = values[f2];
        const len = Math.min(arr1.length, arr2.length);
        let cov = 0;
        for (let i = 0; i < len; i++) {
          cov += (arr1[i] - stats[f1].mean) * (arr2[i] - stats[f2].mean);
        }
        cov /= len;
        const correlation = cov / (stats[f1].std * stats[f2].std);
        corr[f1][f2] = correlation;
      }
    });
  });
  // Create HTML table with colour-coded cells
  const container = document.getElementById('corrContainer');
  container.innerHTML = '';
  const table = document.createElement('table');
  table.className = 'corr-table';
  // Header row
  const headerRow = document.createElement('tr');
  const emptyTh = document.createElement('th');
  headerRow.appendChild(emptyTh);
  features.forEach(f => {
    const th = document.createElement('th');
    th.textContent = f;
    headerRow.appendChild(th);
  });
  table.appendChild(headerRow);
  // Data rows
  features.forEach(f1 => {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.textContent = f1;
    tr.appendChild(th);
    features.forEach(f2 => {
      const td = document.createElement('td');
      const value = corr[f1][f2];
      // Format to 2 decimals
      td.textContent = value.toFixed(2);
      // Colour-code cell
      if (f1 === f2) {
        td.classList.add('corr-diagonal');
      } else {
        const absVal = Math.min(1, Math.abs(value));
        if (value >= 0) {
          // positive: blue scale
          const intensity = Math.floor(255 - absVal * 200);
          td.style.backgroundColor = `rgb(${intensity}, ${intensity + 40}, 255)`;
        } else {
          // negative: pink/red scale
          const intensity = Math.floor(255 - absVal * 200);
          td.style.backgroundColor = `rgb(255, ${intensity}, ${intensity + 60})`;
        }
      }
      tr.appendChild(td);
    });
    table.appendChild(tr);
  });
  container.appendChild(table);
}

function buildPlayers(data) {
  const players = {};
  data.forEach(r => {
    // Count match participation for both players
    if (!players[r.Player_1]) players[r.Player_1] = { total: 0, wins: 0 };
    if (!players[r.Player_2]) players[r.Player_2] = { total: 0, wins: 0 };
    players[r.Player_1].total++;
    players[r.Player_2].total++;
    // Update winner's win count
    if (!players[r.Winner]) players[r.Winner] = { total: 0, wins: 0 };
    players[r.Winner].wins++;
  });
  // Convert to array for sorting
  const playersArr = Object.keys(players).map(name => {
    const record = players[name];
    return { name, total: record.total, wins: record.wins, winRate: record.wins / record.total };
  });
  // Top 10 by total matches
  const topMatches = playersArr.sort((a, b) => b.total - a.total).slice(0, 10);
  // Top 10 by win rate (at least 20 matches to avoid outliers)
  const minMatches = 20;
  const topWinRate = playersArr.filter(p => p.total >= minMatches).sort((a, b) => b.winRate - a.winRate).slice(0, 10);
  // Create bar charts
  new Chart(document.getElementById('topPlayersChart'), {
    type: 'bar',
    data: {
      labels: topMatches.map(p => p.name),
      datasets: [
        {
          label: 'Matches',
          data: topMatches.map(p => p.total),
          backgroundColor: '#79c0ff'
        }
      ]
    },
    options: {
      plugins: { legend: { display: false } },
      indexAxis: 'y',
      scales: {
        x: {
          beginAtZero: true,
          ticks: { color: '#8b949e' },
          grid: { color: 'rgba(255,255,255,0.05)' }
        },
        y: {
          ticks: { color: '#8b949e' },
          grid: { display: false }
        }
      }
    }
  });
  new Chart(document.getElementById('winRatePlayersChart'), {
    type: 'bar',
    data: {
      labels: topWinRate.map(p => p.name),
      datasets: [
        {
          label: 'Win rate (%)',
          data: topWinRate.map(p => (p.winRate * 100).toFixed(2)),
          backgroundColor: '#d2a8ff'
        }
      ]
    },
    options: {
      plugins: { legend: { display: false } },
      indexAxis: 'y',
      scales: {
        x: {
          beginAtZero: true,
          max: 100,
          ticks: { color: '#8b949e' },
          grid: { color: 'rgba(255,255,255,0.05)' }
        },
        y: {
          ticks: { color: '#8b949e' },
          grid: { display: false }
        }
      }
    }
  });
}

function buildSurfaces(data) {
  const surfStats = {};
  data.forEach(r => {
    if (!surfStats[r.Surface]) surfStats[r.Surface] = { total: 0, wins: 0 };
    surfStats[r.Surface].total++;
    if (r.y === 1) surfStats[r.Surface].wins++;
  });
  const surfaces = Object.keys(surfStats);
  const matchCounts = surfaces.map(s => surfStats[s].total);
  const winRates = surfaces.map(s => (surfStats[s].wins / surfStats[s].total) * 100);
  // Bar chart: matches per surface
  new Chart(document.getElementById('surfaceDistChart'), {
    type: 'bar',
    data: {
      labels: surfaces,
      datasets: [
        {
          label: 'Matches',
          data: matchCounts,
          backgroundColor: '#79c0ff'
        }
      ]
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: {
          ticks: { color: '#8b949e' },
          grid: { color: 'rgba(255,255,255,0.05)' }
        },
        y: {
          beginAtZero: true,
          ticks: { color: '#8b949e' },
          grid: { color: 'rgba(255,255,255,0.05)' }
        }
      }
    }
  });
  // Bar chart: win rate per surface
  new Chart(document.getElementById('surfaceWinChart'), {
    type: 'bar',
    data: {
      labels: surfaces,
      datasets: [
        {
          label: 'Win rate (%)',
          data: winRates,
          backgroundColor: '#3fb950'
        }
      ]
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: {
          ticks: { color: '#8b949e' },
          grid: { color: 'rgba(255,255,255,0.05)' }
        },
        y: {
          beginAtZero: true,
          max: 100,
          ticks: { color: '#8b949e' },
          grid: { color: 'rgba(255,255,255,0.05)' }
        }
      }
    }
  });
}