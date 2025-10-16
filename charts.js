// charts.js — robust EDA for WTA dashboard (Chart.js + PapaParse only)

/* ============================
   Helpers
=============================*/

const NUMERIC_HINTS = [
  "rank_1","rank_2","pts_1","pts_2","odd_1","odd_2",
  "rank_diff","pts_diff","odd_diff",
  "h2h_advantage","last_winner","surface_winrate_adv",
  "y","year"
];

function toNum(x) {
  if (x === null || x === undefined) return NaN;
  if (typeof x === "number") return x;
  const s = String(x).replace(/\s|%|,/g, "");
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : NaN;
}

function uniq(arr) { return [...new Set(arr)]; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function percent(n, d) { return d ? Math.round((n / d) * 1000) / 10 : 0; }

/* ============================
   State
=============================*/

let RAW = [];
let NUMERIC_COLS = [];
let CHARTS = {};

/* ============================
   Bootstrap
=============================*/

init();

function init() {
  Papa.parse("wta_data.csv", {
    download: true,
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
    complete: (res) => {
      const data = res.data;
      if (!data || !data.length) {
        document.getElementById("datasetInfo").innerText = "Failed to load CSV.";
        return;
      }
      console.log(`✅ Loaded ${data.length} rows`);
      onCsvLoaded(data);
    },
  });
}

/* ============================
   CSV Handling
=============================*/

function onCsvLoaded(rows) {
  // normalize headers
  const norm = rows.map((r) => {
    const out = {};
    Object.keys(r).forEach((k) => {
      const clean = k.trim().replace(/\s+/g, "_");
      out[clean] = r[k];
    });
    return out;
  });

  // ensure numeric fields exist
  RAW = norm.map((r) => ({
    ...r,
    year: r.year ?? parseInt(String(r.Date).slice(0, 4)),
    y: toNum(r.y),
    rank_diff: toNum(r.rank_diff),
    pts_diff: toNum(r.pts_diff),
    odd_diff: toNum(r.odd_diff),
  }));

  NUMERIC_COLS = Object.keys(RAW[0]).filter(
    (k) => NUMERIC_HINTS.includes(k) || typeof RAW[0][k] === "number"
  );

  renderDatasetOverview(RAW);
  renderMissingness(RAW);
  buildFeatureButtons(NUMERIC_COLS);
  renderDistributions(RAW, NUMERIC_COLS[0]);
  renderCorrelations(RAW, NUMERIC_COLS);
  initPlayerAnalytics(RAW);
}

/* ============================
   Overview
=============================*/

function renderDatasetOverview(rows) {
  const years = rows.map((r) => toNum(r.year)).filter((x) => !isNaN(x));
  const minY = Math.min(...years);
  const maxY = Math.max(...years);
  const html = `
    <div><b>Rows:</b> ${rows.length}</div>
    <div><b>Years:</b> ${minY}–${maxY}</div>
    <div><b>Numeric columns:</b> ${NUMERIC_COLS.join(", ")}</div>
  `;
  document.getElementById("datasetInfo").innerHTML = html;
}

/* ============================
   Missing Values
=============================*/

function renderMissingness(rows) {
  const cols = Object.keys(rows[0]);
  const stats = cols.map((c) => {
    const total = rows.length;
    const miss = rows.filter((r) => !r[c] && r[c] !== 0).length;
    return { c, pct: percent(miss, total) };
  });
  const ctx = document.getElementById("missingChart").getContext("2d");
  if (CHARTS.missing) CHARTS.missing.destroy();
  CHARTS.missing = new Chart(ctx, {
    type: "bar",
    data: {
      labels: stats.map((s) => s.c),
      datasets: [{ label: "% Missing", data: stats.map((s) => s.pct) }],
    },
    options: {
      scales: { y: { beginAtZero: true, ticks: { callback: (v) => v + "%" } } },
    },
  });
}

/* ============================
   Distributions
=============================*/

function buildFeatureButtons(cols) {
  const box = document.getElementById("featureButtons");
  box.innerHTML = "";
  cols.forEach((c, i) => {
    const b = document.createElement("button");
    b.className = "feature-btn" + (i === 0 ? " active" : "");
    b.innerText = c;
    b.onclick = () => {
      document.querySelectorAll(".feature-btn").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      renderDistributions(RAW, c);
    };
    box.appendChild(b);
  });
}

function renderDistributions(rows, col) {
  const vals = rows.map((r) => toNum(r[col])).filter((v) => Number.isFinite(v));
  const n = vals.length;
  if (!n) return;
  vals.sort((a, b) => a - b);
  const k = clamp(Math.round(Math.log2(n) + 1), 5, 25);
  const min = vals[0],
    max = vals[n - 1],
    bin = (max - min) / k;
  const counts = Array(k).fill(0);
  vals.forEach((v) => {
    let i = Math.floor((v - min) / bin);
    if (i >= k) i = k - 1;
    counts[i]++;
  });
  const labels = counts.map((_, i) => `${(min + i * bin).toFixed(1)}–${(min + (i + 1) * bin).toFixed(1)}`);
  const ctx = document.getElementById("distChart").getContext("2d");
  if (CHARTS.dist) CHARTS.dist.destroy();
  CHARTS.dist = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets: [{ label: col, data: counts }] },
    options: { scales: { y: { beginAtZero: true } } },
  });
}

/* ============================
   Correlations
=============================*/

function renderCorrelations(rows, cols) {
  const corr = (a, b) => {
    const xs = [],
      ys = [];
    rows.forEach((r) => {
      const va = toNum(r[a]),
        vb = toNum(r[b]);
      if (Number.isFinite(va) && Number.isFinite(vb)) {
        xs.push(va);
        ys.push(vb);
      }
    });
    if (xs.length < 3) return NaN;
    const mx = xs.reduce((a, b) => a + b) / xs.length;
    const my = ys.reduce((a, b) => a + b) / ys.length;
    let num = 0,
      dx2 = 0,
      dy2 = 0;
    for (let i = 0; i < xs.length; i++) {
      const dx = xs[i] - mx,
        dy = ys[i] - my;
      num += dx * dy;
      dx2 += dx * dx;
      dy2 += dy * dy;
    }
    return num / Math.sqrt(dx2 * dy2);
  };

  const container = document.getElementById("corrContainer");
  let html = `<table class="corr-table"><thead><tr><th></th>`;
  cols.forEach((c) => (html += `<th>${c}</th>`));
  html += `</tr></thead><tbody>`;
  cols.forEach((r) => {
    html += `<tr><th>${r}</th>`;
    cols.forEach((c) => {
      const v = corr(r, c);
      const color = v > 0 ? `rgba(0,255,0,${Math.abs(v)})` : `rgba(255,0,0,${Math.abs(v)})`;
      html += `<td style="background:${color}">${isNaN(v) ? "—" : v.toFixed(2)}</td>`;
    });
    html += "</tr>";
  });
  html += "</tbody></table>";
  container.innerHTML = html;
}

/* ============================
   Player Analytics (NEW)
=============================*/

function initPlayerAnalytics(rows) {
  populateYearFilter(rows);
  renderPlayerAnalytics(rows);
}

function populateYearFilter(rows) {
  const years = uniq(rows.map((r) => toNum(r.year)).filter((x) => !isNaN(x))).sort((a, b) => b - a);
  const sel = document.getElementById("yearSelect");
  sel.innerHTML = years.map((y) => `<option value="${y}">${y}</option>`).join("");
  sel.onchange = () => renderPlayerAnalytics(rows);
}

function renderPlayerAnalytics(rows) {
  const year = toNum(document.getElementById("yearSelect").value);
  const filtered = year ? rows.filter((r) => toNum(r.year) === year) : rows;
  if (!filtered.length) return;

  // Aggregate by player
  const stats = {};
  filtered.forEach((r) => {
    const p1 = r.Player_1 || r.player_1;
    const p2 = r.Player_2 || r.player_2;
    const y = toNum(r.y);
    if (!p1 || !p2) return;
    stats[p1] = stats[p1] || { matches: 0, wins: 0 };
    stats[p2] = stats[p2] || { matches: 0, wins: 0 };
    stats[p1].matches++;
    stats[p2].matches++;
    if (y === 1) stats[p1].wins++;
    else if (y === 0) stats[p2].wins++;
  });

  const players = Object.entries(stats).map(([p, s]) => ({
    player: p,
    matches: s.matches,
    wins: s.wins,
    winrate: percent(s.wins, s.matches),
  }));
  const top = players.sort((a, b) => b.wins - a.wins).slice(0, 10);

  // 🏆 Top wins
  drawBar("topWinsChart", "Top 10 by Wins", top.map((t) => t.player), top.map((t) => t.wins));

  // 💪 Winrate
  drawBar("winRateChart", "Winrate (%)", top.map((t) => t.player), top.map((t) => t.winrate), "%");

  // 🎾 Surface distribution
  const surf = {};
  filtered.forEach((r) => {
    const s = (r.Surface || "").toLowerCase();
    if (!s) return;
    surf[s] = (surf[s] || 0) + 1;
  });
  const sKeys = Object.keys(surf);
  const sVals = Object.values(surf);
  drawPie("surfaceChart", sKeys, sVals);

  // 📈 Trend over years
  const grouped = {};
  rows.forEach((r) => {
    const y = toNum(r.year);
    if (!y) return;
    grouped[y] = grouped[y] || { wins: 0, matches: 0 };
    const res = toNum(r.y);
    grouped[y].matches++;
    if (res === 1) grouped[y].wins++;
  });
  const yKeys = Object.keys(grouped).sort((a, b) => a - b);
  const wr = yKeys.map((y) => percent(grouped[y].wins, grouped[y].matches));
  drawLine("trendChart", yKeys, wr);
}

/* ============================
   Chart helpers
=============================*/

function drawBar(id, label, labels, data, suffix = "") {
  const ctx = document.getElementById(id).getContext("2d");
  if (CHARTS[id]) CHARTS[id].destroy();
  CHARTS[id] = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets: [{ label, data }] },
    options: {
      responsive: true,
      scales: { y: { beginAtZero: true, ticks: { callback: (v) => v + suffix } } },
    },
  });
}

function drawPie(id, labels, data) {
  const ctx = document.getElementById(id).getContext("2d");
  if (CHARTS[id]) CHARTS[id].destroy();
  CHARTS[id] = new Chart(ctx, {
    type: "pie",
    data: { labels, datasets: [{ data }] },
  });
}

function drawLine(id, labels, data) {
  const ctx = document.getElementById(id).getContext("2d");
  if (CHARTS[id]) CHARTS[id].destroy();
  CHARTS[id] = new Chart(ctx, {
    type: "line",
    data: { labels, datasets: [{ label: "Winrate %", data, borderWidth: 2 }] },
    options: { responsive: true, scales: { y: { beginAtZero: true } } },
  });
}
