// charts.js — robust EDA for WTA dashboard (Chart.js + PapaParse only)

/* ============================
   Helpers
=============================*/

const NUMERIC_HINTS = [
  "rank_1",
  "rank_2",
  "pts_1",
  "pts_2",
  "odd_1",
  "odd_2",
  "rank_diff",
  "pts_diff",
  "odd_diff",
  "recent_win_rate_5",
  "recent_win_rate_10",
  "h2h_advantage",
  "last_winner",
  "surface_winrate_adv",
  "rolling_win_rate_10",
  "streak",
  "streak_value",
  "fatigue_7d",
  "fatigue_14d",
  "fatigue_30d",
  "surface_trend",
  "y",
  "year",
];

// Columns that should be exported for model training / inference.
// Restrict the downloadable dataset to only model-ready features and the target.
const MODEL_EXPORT_COLUMNS = [
  "y",
  "match_date",
  "Date",
  "Player_1",
  "Player_2",
  "Rank_1",
  "Rank_2",
  "Pts_1",
  "Pts_2",
  "Odd_1",
  "Odd_2",
  "Tournament",
  "rank_diff",
  "pts_diff",
  "odd_diff",
  "h2h_advantage",
  "last_winner",
  "surface_winrate_adv",
  "year",
  "Surface",
  "Court",
  "Round",
  "recent_win_rate_5",
  "recent_win_rate_10",
  "streak_value",
  "fatigue_7d",
  "fatigue_14d",
  "fatigue_30d",
  "surface_trend",
];

const CORR_REQUIRED_FEATURES = [
  "recent_win_rate_5",
  "recent_win_rate_10",
  "streak_value",
  "fatigue_7d",
  "fatigue_14d",
  "fatigue_30d",
  "surface_trend",
];

const DATASET_MODES = {
  WTA: {
    path: "wta_data.csv",
    label: "WTA dataset",
  },
  ATP: {
    path: "atp_data.csv", // place Kaggle-exported ATP CSV at this path
    label: "ATP dataset (Kaggle: m3financial/atp-tennis-data-from-201201-to-201707)",
  },
};

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
let PLAYER_NAMES = [];
let CURRENT_SOURCE = "";
let CURRENT_MODE = "WTA";
let PENDING_UPLOAD = null;

/* ============================
   Bootstrap
=============================*/

document.addEventListener("DOMContentLoaded", init);

function init() {
  setupModeToggle();
  setupDatasetUpload();
  setupAnalyzeControl();
  loadDatasetForMode(CURRENT_MODE);
}

/* ============================
   CSV Handling
=============================*/

function setDatasetSource(label) {
  const el = document.getElementById("datasetSource");
  if (el) el.innerText = label;
}

function setupModeToggle() {
  const wtaBtn = document.getElementById("modeWTA");
  const atpBtn = document.getElementById("modeATP");
  if (!wtaBtn || !atpBtn) return;

  const activate = (mode) => {
    CURRENT_MODE = mode;
    [wtaBtn, atpBtn].forEach((btn) => btn.classList.remove("active"));
    (mode === "ATP" ? atpBtn : wtaBtn).classList.add("active");
    loadDatasetForMode(mode);
  };

  wtaBtn.onclick = () => activate("WTA");
  atpBtn.onclick = () => activate("ATP");
}

function setAnalyzeButton(enabled, label = "Analyze Dataset") {
  const btn = document.getElementById("analyzeDataset");
  if (!btn) return;
  btn.disabled = !enabled;
  btn.innerText = label;
}

function resetVisuals() {
  RAW = [];
  NUMERIC_COLS = [];
  PLAYER_NAMES = [];

  Object.values(CHARTS).forEach((c) => {
    if (c && typeof c.destroy === "function") c.destroy();
  });
  CHARTS = {};

  const containers = ["featureButtons", "corrContainer"];
  containers.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = "";
  });

  const tableBody = document.querySelector("#featureQualityTable tbody");
  if (tableBody) tableBody.innerHTML = "";

  const selects = [
    "playerSelect",
    "playerStreakSelect",
    "playerFatigueSelect",
    "playerSurfaceSelect",
    "yearSelect",
  ];
  selects.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = "";
  });

  [
    "playerTimelineMessage",
    "streakTimelineMessage",
    "fatigueTimelineMessage",
    "surfaceTrendMessage",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.innerText = "";
  });
}

function loadDatasetForMode(mode = "WTA") {
  const info = document.getElementById("datasetInfo");
  const cfg = DATASET_MODES[mode] || DATASET_MODES.WTA;
  CURRENT_MODE = mode in DATASET_MODES ? mode : "WTA";
  PENDING_UPLOAD = null;
  setAnalyzeButton(false);

  if (info) info.innerText = `Loading ${cfg.label}...`;
  setDatasetSource(`Source: ${cfg.label} (${cfg.path})`);

  Papa.parse(cfg.path, {
    download: true,
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
    complete: (res) => {
      const data = res.data;
      if (!data || !data.length) {
        if (info)
          info.innerText = `Failed to load ${cfg.label}. Ensure the file ${cfg.path} is accessible.`;
        return;
      }
      console.log(`✅ Loaded ${data.length} rows from ${cfg.path}`);
      resetVisuals();
      CURRENT_SOURCE = `${cfg.label}`;
      onCsvLoaded(data, CURRENT_SOURCE);
    },
    error: (err) => {
      if (info) info.innerText = `Error loading ${cfg.label}: ${err}`;
    },
  });
}

function setupDatasetUpload() {
  const input = document.getElementById("datasetUpload");
  const trigger = document.getElementById("uploadTrigger");
  if (!input || !trigger) return;

  trigger.onclick = () => input.click();

  input.onchange = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    e.target.value = "";

    const info = document.getElementById("datasetInfo");
    if (info) info.innerText = `Loading ${file.name}...`;

    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: (res) => {
        const data = res.data;
        if (!data || !data.length) {
          if (info) info.innerText = `Failed to load ${file.name}.`;
          return;
        }
        console.log(`✅ Loaded ${data.length} rows from ${file.name}`);
        PENDING_UPLOAD = { rows: data, label: file.name };
        setAnalyzeButton(true);
        setDatasetSource(`Source: pending ${file.name}`);
        if (info) info.innerText = `Parsed ${file.name}. Click Analyze to preprocess.`;
      },
    });
  };
}

function setupAnalyzeControl() {
  const btn = document.getElementById("analyzeDataset");
  if (!btn) return;

  btn.onclick = () => {
    if (!PENDING_UPLOAD) {
      console.warn("No uploaded dataset to analyze.");
      const info = document.getElementById("datasetInfo");
      if (info) info.innerText = "Upload a CSV first, then click Analyze.";
      return;
    }

    const { rows, label } = PENDING_UPLOAD;
    const info = document.getElementById("datasetInfo");
    if (info) info.innerText = `Analyzing ${label}...`;

    resetVisuals();
    CURRENT_SOURCE = label;
    onCsvLoaded(rows, label);
    PENDING_UPLOAD = null;
    setAnalyzeButton(false);
  };
}

function onCsvLoaded(rows, sourceLabel = "Custom CSV") {
  setDatasetSource(`Source: ${sourceLabel}`);
  // normalize headers
  const norm = rows.map((r) => {
    const out = {};
    Object.keys(r).forEach((k) => {
      const clean = k.trim().replace(/\s+/g, "_");
      out[clean] = r[k];
    });
    return out;
  });

  const baseRows = ensureFeatureEngineering(norm);

  // ensure numeric fields exist
  RAW = baseRows.map((r) => {
    const dateStr = r.match_date || r.matchDate || r.Date || r.date;
    const normalizedDate = normalizeDateString(dateStr);
    const mapped = {
      ...r,
      Date: normalizedDate,
      match_date: normalizedDate,
      year: r.year ?? parseInt(String(normalizedDate || "").slice(0, 4)),
      y: toNum(r.y),
      rank_diff: toNum(r.rank_diff),
      pts_diff: toNum(r.pts_diff),
      odd_diff: toNum(r.odd_diff),
    };

    delete mapped.surface_win_rate_hard_5;
    delete mapped.surface_win_rate_clay_5;
    delete mapped.surface_win_rate_grass_5;
    return mapped;
  });

  computePlayerFormFeatures(RAW);
  computePlayerFatigueFeatures(RAW);
  computePlayerSurfaceTrendFeatures(RAW);

  NUMERIC_COLS = Object.keys(RAW[0]).filter(
    (k) => NUMERIC_HINTS.includes(k) || typeof RAW[0][k] === "number"
  );

  PLAYER_NAMES = uniq(
    RAW.flatMap((r) => [r.Player_1 || r.player_1 || r.Player1 || r.player1, r.Player_2 || r.player_2 || r.Player2 || r.player2])
  )
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  const corrCols = collectCorrelationColumns(RAW, NUMERIC_COLS);

  renderDatasetOverview(RAW);
  renderMissingness(RAW);
  buildFeatureButtons(NUMERIC_COLS);
  renderDistributions(RAW, NUMERIC_COLS[0]);
  renderCorrelations(RAW, corrCols);
  renderFeatureQualityPanel(RAW, NUMERIC_COLS);
  initPlayerAnalytics(RAW);
  setupDatasetDownload();
}

function ensureFeatureEngineering(rows) {
  if (!rows || !rows.length) return [];
  const sample = rows[0];
  const needsProcessing =
    !("h2h_advantage" in sample) ||
    !("last_winner" in sample) ||
    !("surface_winrate_adv" in sample) ||
    !("rank_diff" in sample) ||
    !("pts_diff" in sample) ||
    !("odd_diff" in sample) ||
    !("y" in sample);

  return needsProcessing ? preprocessRawDataset(rows) : rows;
}

function preprocessRawDataset(rows) {
  const normName = (s) => (s || "").toString().trim();
  const normLower = (s) => normName(s).toLowerCase();
  const surfaces = ["hard", "clay", "grass"];

  const cleaned = [];
  const seen = new Set();

  rows.forEach((r) => {
    const dateStr = r.Date || r.date || r.match_date || r.matchDate;
    const date = dateStr ? new Date(dateStr) : null;
    if (!date || isNaN(date)) return;

    const p1 = r.Player_1 || r.player_1 || r.Player1 || r.player1;
    const p2 = r.Player_2 || r.player_2 || r.Player2 || r.player2;
    const winner = r.Winner || r.winner;
    const winnerNorm = normLower(winner);
    if (!p1 || !p2 || !winnerNorm) return;

    const p1Norm = normLower(p1);
    const p2Norm = normLower(p2);
    if (winnerNorm !== p1Norm && winnerNorm !== p2Norm) return;

    const pts1 = toNum(r.Pts_1 || r.pts_1);
    const pts2 = toNum(r.Pts_2 || r.pts_2);
    if ((Number.isFinite(pts1) && pts1 < 0) || (Number.isFinite(pts2) && pts2 < 0)) return;

    const sig = [
      date.toISOString().slice(0, 10),
      r.Tournament || r.tournament,
      r.Round || r.round,
      p1,
      p2,
    ].join("|");

    if (seen.has(sig)) return;
    seen.add(sig);

    cleaned.push({
      ...r,
      Date: date,
      Player_1: p1,
      Player_2: p2,
      Winner: winner,
      Rank_1: toNum(r.Rank_1 || r.rank_1 || r.Player1_Rank || r.player1_rank),
      Rank_2: toNum(r.Rank_2 || r.rank_2 || r.Player2_Rank || r.player2_rank),
      Pts_1: pts1,
      Pts_2: pts2,
      Odd_1: toNum(r.Odd_1 || r.odd_1 || r.Player1_Odds || r.player1_odds),
      Odd_2: toNum(r.Odd_2 || r.odd_2 || r.Player2_Odds || r.player2_odds),
      Surface: r.Surface || r.surface,
      Court: r.Court || r.court,
      Round: r.Round || r.round,
      year: date.getFullYear(),
    });
  });

  cleaned.sort((a, b) => a.Date - b.Date);

  const h2hWins = new Map();
  const lastWinnerMap = new Map();
  const surfaceWins = new Map();

  const swapNeeded = (row) => {
    const r1 = row.Rank_1;
    const r2 = row.Rank_2;
    const o1 = row.Odd_1;
    const o2 = row.Odd_2;
    if (Number.isFinite(r1) && Number.isFinite(r2) && r1 > r2) return true;
    if (!Number.isFinite(r1) && Number.isFinite(r2)) return true;
    if (Number.isFinite(r1) && Number.isFinite(r2) && r1 === r2 && Number.isFinite(o1) && Number.isFinite(o2))
      return o1 > o2;
    return false;
  };

  cleaned.forEach((row) => {
    if (swapNeeded(row)) {
      [row.Player_1, row.Player_2] = [row.Player_2, row.Player_1];
      [row.Rank_1, row.Rank_2] = [row.Rank_2, row.Rank_1];
      [row.Pts_1, row.Pts_2] = [row.Pts_2, row.Pts_1];
      [row.Odd_1, row.Odd_2] = [row.Odd_2, row.Odd_1];
    }

    const p1 = row.Player_1;
    const p2 = row.Player_2;
    const key = [p1, p2].sort().join("|");

    row.y = normLower(row.Winner) === normLower(row.Player_1) ? 1 : 0;
    row.rank_diff = toNum(row.Rank_2) - toNum(row.Rank_1);
    row.pts_diff = toNum(row.Pts_1) - toNum(row.Pts_2);
    row.odd_diff = toNum(row.Odd_2) - toNum(row.Odd_1);

    const [winsA = 0, winsB = 0] = h2hWins.get(key) || [0, 0];
    if (p1 === key.split("|")[0]) row.h2h_advantage = winsA - winsB;
    else row.h2h_advantage = winsB - winsA;

    const lastWin = lastWinnerMap.get(key);
    if (lastWin === p1) row.last_winner = 1;
    else if (lastWin === p2) row.last_winner = 0;
    else row.last_winner = NaN;

    const surf = (row.Surface || "").toString().toLowerCase();
    if (!surfaces.includes(surf)) row.surface_winrate_adv = 0;
    else {
      const key1 = `${p1}|${surf}`;
      const key2 = `${p2}|${surf}`;
      const [w1 = 0, t1 = 0] = surfaceWins.get(key1) || [0, 0];
      const [w2 = 0, t2 = 0] = surfaceWins.get(key2) || [0, 0];
      const winrate1 = t1 > 0 ? w1 / t1 : NaN;
      const winrate2 = t2 > 0 ? w2 / t2 : NaN;
      const adv = winrate1 - winrate2;
      row.surface_winrate_adv = Number.isFinite(adv) ? adv : 0;
    }

    // update trackers after computing advantage
    if (row.y === 1) {
      const baseKey = `${p1}|${surf}`;
      const [w = 0, t = 0] = surfaceWins.get(baseKey) || [0, 0];
      surfaceWins.set(baseKey, [w + 1, t + 1]);
      const baseKey2 = `${p2}|${surf}`;
      const [w2 = 0, t2 = 0] = surfaceWins.get(baseKey2) || [0, 0];
      surfaceWins.set(baseKey2, [w2, t2 + 1]);
    } else {
      const baseKey = `${p1}|${surf}`;
      const [w = 0, t = 0] = surfaceWins.get(baseKey) || [0, 0];
      surfaceWins.set(baseKey, [w, t + 1]);
      const baseKey2 = `${p2}|${surf}`;
      const [w2 = 0, t2 = 0] = surfaceWins.get(baseKey2) || [0, 0];
      surfaceWins.set(baseKey2, [w2 + 1, t2 + 1]);
    }

    if (row.y === 1) {
      if (p1 === key.split("|")[0]) h2hWins.set(key, [winsA + 1, winsB]);
      else h2hWins.set(key, [winsA, winsB + 1]);
    } else {
      if (p1 === key.split("|")[0]) h2hWins.set(key, [winsA, winsB + 1]);
      else h2hWins.set(key, [winsA + 1, winsB]);
    }

    lastWinnerMap.set(key, row.Winner);
  });

  return cleaned.map((r) => ({
    ...r,
    Date: normalizeDateString(r.Date),
    match_date: normalizeDateString(r.Date),
  }));
}

function normalizeDateString(value) {
  if (value instanceof Date && !isNaN(value)) return value.toISOString().slice(0, 10);
  if (!value) return value;
  const parsed = new Date(value);
  return isNaN(parsed) ? value : parsed.toISOString().slice(0, 10);
}

function computePlayerFormFeatures(rows) {
  const normName = (s) => (s || "").toString().trim().toLowerCase();

  rows.forEach((r) => {
    r.recent_win_rate_5 = null;
    r.recent_win_rate_10 = null;
    r.rolling_win_rate_10 = null;
    r.streak = null;
    r.streak_value = null;
  });

  const matchesByPlayer = new Map();

  rows.forEach((r, idx) => {
    const dateStr = r.match_date || r.Date || r.date;
    const date = dateStr ? new Date(dateStr) : null;
    if (!date || isNaN(date)) return;

    const p1 = r.Player_1 || r.player_1 || r.Player1 || r.player1;
    const p2 = r.Player_2 || r.player_2 || r.Player2 || r.player2;
    const winnerNorm = normName(r.Winner || r.winner);

    [p1, p2].forEach((name) => {
      const key = normName(name);
      if (!key) return;
      if (!matchesByPlayer.has(key)) matchesByPlayer.set(key, []);
      matchesByPlayer.get(key).push({
        index: idx,
        date,
        isWin: winnerNorm && winnerNorm === key,
      });
    });
  });

  matchesByPlayer.forEach((matches, playerKey) => {
    matches.sort((a, b) => a.date - b.date || a.index - b.index);
    let streak = 0;
    const wins = [];

    matches.forEach((m) => {
      const result = m.isWin ? 1 : 0;
      streak = result ? (streak >= 0 ? streak + 1 : 1) : streak <= 0 ? streak - 1 : -1;
      wins.push(result);
      const window5 = wins.slice(Math.max(0, wins.length - 5));
      const window10 = wins.slice(Math.max(0, wins.length - 10));
      const rate5 = window5.reduce((a, b) => a + b, 0) / window5.length;
      const rate10 = window10.reduce((a, b) => a + b, 0) / window10.length;

      const row = rows[m.index];
      const player1Key = normName(row.Player_1 || row.player_1 || row.Player1 || row.player1);
      if (player1Key === playerKey) {
        row.recent_win_rate_5 = Math.round(rate5 * 100) / 100;
        row.recent_win_rate_10 = Math.round(rate10 * 100) / 100;
        row.rolling_win_rate_10 = Math.round(rate10 * 100) / 100;
        row.streak = streak;
        row.streak_value = streak;
      }
    });
  });
}

function computePlayerFatigueFeatures(rows) {
  const normName = (s) => (s || "").toString().trim().toLowerCase();
  const dayMs = 24 * 60 * 60 * 1000;

  rows.forEach((r) => {
    r.fatigue_7d = null;
    r.fatigue_14d = null;
    r.fatigue_30d = null;
  });

  const matchesByPlayer = new Map();

  rows.forEach((r, idx) => {
    const dateStr = r.match_date || r.Date || r.date;
    const date = dateStr ? new Date(dateStr) : null;
    if (!date || isNaN(date)) return;

    const p1 = r.Player_1 || r.player_1 || r.Player1 || r.player1;
    const p2 = r.Player_2 || r.player_2 || r.Player2 || r.player2;

    [p1, p2].forEach((name) => {
      const key = normName(name);
      if (!key) return;
      if (!matchesByPlayer.has(key)) matchesByPlayer.set(key, []);
      matchesByPlayer.get(key).push({ index: idx, date, ts: date.getTime() });
    });
  });

  matchesByPlayer.forEach((matches, playerKey) => {
    matches.sort((a, b) => a.ts - b.ts || a.index - b.index);

    let start7 = 0,
      start14 = 0,
      start30 = 0;

    matches.forEach((m, i) => {
      while (start7 < i && matches[start7].ts <= m.ts - 7 * dayMs) start7++;
      while (start14 < i && matches[start14].ts <= m.ts - 14 * dayMs) start14++;
      while (start30 < i && matches[start30].ts <= m.ts - 30 * dayMs) start30++;

      const fatigue7 = i - start7;
      const fatigue14 = i - start14;
      const fatigue30 = i - start30;

      const row = rows[m.index];
      const player1Key = normName(row.Player_1 || row.player_1 || row.Player1 || row.player1);
      if (player1Key === playerKey) {
        row.fatigue_7d = fatigue7;
        row.fatigue_14d = fatigue14;
        row.fatigue_30d = fatigue30;
      }
    });
  });
}

function computePlayerSurfaceTrendFeatures(rows) {
  const normName = (s) => (s || "").toString().trim().toLowerCase();
  const surfaces = ["hard", "clay", "grass"];

  rows.forEach((r) => {
    r.surface_trend = 0;
  });

  const matchesByPlayerSurface = new Map();

  rows.forEach((r, idx) => {
    const surf = (r.Surface || r.surface || "").toString().toLowerCase();
    if (!surfaces.includes(surf)) return;

    const dateStr = r.match_date || r.Date || r.date;
    const date = dateStr ? new Date(dateStr) : null;
    if (!date || isNaN(date)) return;

    const p1 = r.Player_1 || r.player_1 || r.Player1 || r.player1;
    const p2 = r.Player_2 || r.player_2 || r.Player2 || r.player2;
    const winnerNorm = normName(r.Winner || r.winner);

    [p1, p2].forEach((name) => {
      const key = normName(name);
      if (!key) return;
      const mapKey = `${key}|${surf}`;
      if (!matchesByPlayerSurface.has(mapKey)) matchesByPlayerSurface.set(mapKey, []);
      matchesByPlayerSurface.get(mapKey).push({
        index: idx,
        surface: surf,
        ts: date.getTime(),
        date,
        isWin: winnerNorm && winnerNorm === key,
      });
    });
  });

  matchesByPlayerSurface.forEach((matches, mapKey) => {
    matches.sort((a, b) => a.ts - b.ts || a.index - b.index);
    const wins = [];

    const [playerKey, surface] = mapKey.split("|");

    matches.forEach((m) => {
      const shortWins = wins.slice(Math.max(0, wins.length - 5));
      const longWins = wins.slice(Math.max(0, wins.length - 15));

      const shortRate = shortWins.length
        ? shortWins.reduce((a, b) => a + b, 0) / shortWins.length
        : 0;
      const longRate = longWins.length
        ? longWins.reduce((a, b) => a + b, 0) / longWins.length
        : 0;
      const trend = clamp(shortRate - longRate, -1, 1);

      const row = rows[m.index];
      const player1Key = normName(row.Player_1 || row.player_1 || row.Player1 || row.player1);
      const surf = (row.Surface || row.surface || "").toLowerCase();
      if (player1Key === playerKey && surf === surface) {
        row.surface_trend = Math.round(trend * 100) / 100;
      }

      wins.push(m.isWin ? 1 : 0);
    });
  });
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

function collectCorrelationColumns(rows, numericCols) {
  const colSet = new Set(numericCols);
  CORR_REQUIRED_FEATURES.forEach((f) => colSet.add(f));

  return [...colSet].filter((c) => rows.some((r) => Number.isFinite(toNum(r[c]))));
}

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
   Feature Quality Panel
=============================*/

function computeFeatureQualityStats(rows, numericCols) {
  return numericCols.map((feature) => {
    const vals = rows
      .map((r) => toNum(r[feature]))
      .filter((v) => Number.isFinite(v));
    const total = rows.length || 1;
    const missingRate = (total - vals.length) / total;

    if (!vals.length) {
      return { feature, std: 0, range: 0, missing_rate: missingRate };
    }

    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / vals.length;
    const std = Math.sqrt(variance);
    const min = Math.min(...vals);
    const max = Math.max(...vals);

    return { feature, std, range: max - min, missing_rate: missingRate };
  });
}

function renderFeatureQualityPanel(rows, numericCols) {
  const sortSelect = document.getElementById("qualitySortSelect");
  const tableBody = document.querySelector("#featureQualityTable tbody");
  const canvas = document.getElementById("qualityBarChart");
  if (!sortSelect || !tableBody || !canvas) return;

  if (!sortSelect.dataset.bound) {
    sortSelect.onchange = () => renderFeatureQualityPanel(rows, numericCols);
    sortSelect.dataset.bound = "1";
  }

  const stats = computeFeatureQualityStats(rows, numericCols);
  const sortBy = sortSelect.value || "std";

  const sorted = [...stats].sort((a, b) => (b[sortBy] ?? -Infinity) - (a[sortBy] ?? -Infinity));

  const fmt = (v, digits = 3) => (Number.isFinite(v) ? v.toFixed(digits) : "—");

  tableBody.innerHTML = "";
  sorted.forEach((s) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${s.feature}</td>
      <td>${fmt(s.std)}</td>
      <td>${fmt(s.range)}</td>
      <td>${(s.missing_rate * 100).toFixed(1)}%</td>
    `;
    tableBody.appendChild(tr);
  });

  const top = sorted.slice(0, 10);
  const labels = top.map((t) => t.feature);
  const data = top.map((t) =>
    sortBy === "missing_rate" ? Math.round(t.missing_rate * 1000) / 10 : t[sortBy]
  );
  const metricLabel =
    sortBy === "missing_rate" ? "Missing %" : sortBy === "range" ? "Range" : "Std";

  const ctx = canvas.getContext("2d");
  if (CHARTS.qualityBar) CHARTS.qualityBar.destroy();
  CHARTS.qualityBar = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: metricLabel,
          data,
          backgroundColor: "rgba(88,166,255,0.6)",
        },
      ],
    },
    options: {
      scales: { y: { beginAtZero: true } },
      plugins: { legend: { display: false } },
    },
  });
}

/* ============================
   Player Analytics (NEW)
=============================*/

function initPlayerAnalytics(rows) {
  populateYearFilter(rows);
  populatePlayerInput(PLAYER_NAMES);
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

  // Prefill player selector with current top player if empty
  const selectIds = [
    "playerSelect",
    "playerStreakSelect",
    "playerFatigueSelect",
    "playerSurfaceSelect",
  ];
  const targetSelect = selectIds
    .map((id) => document.getElementById(id))
    .find((el) => el && !el.value);

  if (targetSelect && top.length) {
    selectIds
      .map((id) => document.getElementById(id))
      .filter(Boolean)
      .forEach((el) => (el.value = top[0].player));
    renderWinRateTimeline(RAW, top[0].player);
    renderStreakTimeline(RAW, top[0].player);
    renderFatigueTimeline(RAW, top[0].player);
    renderSurfaceTrendTimeline(RAW, top[0].player);
  }
}

function populatePlayerInput(names) {
  const selects = [
    document.getElementById("playerSelect"),
    document.getElementById("playerStreakSelect"),
    document.getElementById("playerFatigueSelect"),
    document.getElementById("playerSurfaceSelect"),
  ].filter(Boolean);
  if (!selects.length) return;

  const options = ["<option value=\"\">Select player</option>"];
  names.forEach((n) => options.push(`<option value="${n}">${n}</option>`));
  selects.forEach((sel) => (sel.innerHTML = options.join("")));

  const syncAndRender = (value) => {
    selects.forEach((s) => {
      if (s.value !== value) s.value = value;
    });
    renderWinRateTimeline(RAW, value);
    renderStreakTimeline(RAW, value);
    renderFatigueTimeline(RAW, value);
    renderSurfaceTrendTimeline(RAW, value);
  };

  selects.forEach((sel) => {
    sel.onchange = (e) => {
      const value = (e.target.value || "").trim();
      syncAndRender(value);
    };
  });
}

function setupDatasetDownload() {
  const btn = document.getElementById("downloadDataset");
  if (!btn) return;

  btn.onclick = () => {
    if (!RAW.length) {
      console.warn("No data loaded to export.");
      return;
    }
    const filtered = RAW.map((row) => {
      const clean = {};
      MODEL_EXPORT_COLUMNS.forEach((col) => {
        if (row.hasOwnProperty(col)) clean[col] = row[col];
      });
      return clean;
    });

    const csv = Papa.unparse(filtered);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "feature_engineered.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };
}

function renderWinRateTimeline(rows, presetName) {
  const message = document.getElementById("playerTimelineMessage");
  const select = document.getElementById("playerSelect");
  const linkedSelects = [
    document.getElementById("playerStreakSelect"),
    document.getElementById("playerFatigueSelect"),
    document.getElementById("playerSurfaceSelect"),
  ];
  if (select && presetName) {
    select.value = presetName;
  }
  linkedSelects
    .filter(Boolean)
    .forEach((el) => {
      if (presetName) el.value = presetName;
    });
  const targetName = (presetName || (select && select.value) || "").trim();

  const clearChart = (text) => {
    if (message) message.innerText = text || "";
    if (CHARTS.winrateTimeline) {
      CHARTS.winrateTimeline.destroy();
      CHARTS.winrateTimeline = null;
    }
  };

  if (!targetName) {
    clearChart("Select a player to see their rolling win rate.");
    return;
  }

  const normTarget = targetName.toLowerCase();
  const matches = rows.filter((r) => {
    const p1 = (r.Player_1 || r.player_1 || "").toLowerCase();
    const p2 = (r.Player_2 || r.player_2 || "").toLowerCase();
    return p1 === normTarget || p2 === normTarget;
  });

  if (!matches.length) {
    clearChart("Player has no match history.");
    return;
  }

  const withDates = matches
    .map((m, idx) => ({
      ...m,
      _dateStr: m.match_date || m.Date || m.date,
      _date: new Date(m.match_date || m.Date || m.date),
      _ts: new Date(m.match_date || m.Date || m.date).getTime(),
      _idx: idx,
    }))
    .filter((m) => m._dateStr && !isNaN(m._date));

  const orderBroken = withDates.some((m, i) => {
    if (i === 0) return false;
    return withDates[i - 1]._date > m._date;
  });
  if (orderBroken) {
    console.error(`Match dates for ${targetName} are not sorted; re-sorting.`);
  }

  const sorted = withDates.sort((a, b) => a._date - b._date);
  const wins = [];
  const timeline = sorted.map((m) => {
    const winner = (m.Winner || m.winner || "").toLowerCase();
    wins.push(winner === normTarget ? 1 : 0);
    const window = wins.slice(Math.max(0, wins.length - 10));
    const rate = window.reduce((a, b) => a + b, 0) / window.length;
    return {
      date: m._dateStr,
      rolling_win_rate: Math.round(rate * 100) / 100,
    };
  });

  if (!timeline.length) {
    clearChart("Player has no match history.");
    return;
  }

  if (message) message.innerText = `${targetName} — rolling win rate over last 10 matches (adapts for fewer matches).`;
  const ctx = document.getElementById("winrateTimeline").getContext("2d");
  if (CHARTS.winrateTimeline) CHARTS.winrateTimeline.destroy();
  CHARTS.winrateTimeline = new Chart(ctx, {
    type: "line",
    data: {
      labels: timeline.map((t) => t.date),
      datasets: [
        {
          label: "Rolling Win Rate",
          data: timeline.map((t) => t.rolling_win_rate),
          borderColor: "#58a6ff",
          backgroundColor: "rgba(88,166,255,0.15)",
          borderWidth: 2,
          fill: true,
          tension: 0.25,
        },
      ],
    },
    options: {
      responsive: true,
      scales: {
        y: { beginAtZero: true, max: 1, ticks: { callback: (v) => v.toFixed(2) } },
      },
      plugins: {
        tooltip: {
          callbacks: {
            label: (ctx) => `Win Rate: ${(ctx.parsed.y * 100).toFixed(1)}%`,
          },
        },
      },
    },
  });
}

function renderStreakTimeline(rows, presetName) {
  const message = document.getElementById("streakTimelineMessage");
  const select = document.getElementById("playerStreakSelect");
  const linkedSelects = [
    document.getElementById("playerSelect"),
    document.getElementById("playerFatigueSelect"),
    document.getElementById("playerSurfaceSelect"),
  ];
  if (select && presetName) {
    select.value = presetName;
  }
  linkedSelects
    .filter(Boolean)
    .forEach((el) => {
      if (presetName) el.value = presetName;
    });
  const targetName = (presetName || (select && select.value) || "").trim();

  const clearChart = (text) => {
    if (message) message.innerText = text || "";
    if (CHARTS.streakTimeline) {
      CHARTS.streakTimeline.destroy();
      CHARTS.streakTimeline = null;
    }
  };

  if (!targetName) {
    clearChart("Select a player to see their streak timeline.");
    return;
  }

  const normTarget = targetName.toLowerCase();
  const matches = rows.filter((r) => {
    const p1 = (r.Player_1 || r.player_1 || "").toLowerCase();
    const p2 = (r.Player_2 || r.player_2 || "").toLowerCase();
    return p1 === normTarget || p2 === normTarget;
  });

  if (!matches.length) {
    clearChart("Player has no match history.");
    return;
  }

  const withDates = matches
    .map((m, idx) => ({
      ...m,
      _dateStr: m.match_date || m.Date || m.date,
      _date: new Date(m.match_date || m.Date || m.date),
      _ts: new Date(m.match_date || m.Date || m.date).getTime(),
      _idx: idx,
    }))
    .filter((m) => m._dateStr && !isNaN(m._date));

  const orderBroken = withDates.some((m, i) => {
    if (i === 0) return false;
    return withDates[i - 1]._date > m._date;
  });
  if (orderBroken) {
    console.error(`Match dates for ${targetName} are not sorted; re-sorting.`);
  }

  const sorted = withDates.sort((a, b) => a._date - b._date);
  let streak = 0;
  const timeline = sorted.map((m) => {
    const winner = (m.Winner || m.winner || "").toLowerCase();
    const isWin = winner === normTarget;
    if (isWin) {
      streak = streak >= 0 ? streak + 1 : 1;
    } else {
      streak = streak <= 0 ? streak - 1 : -1;
    }
    return {
      date: m._dateStr,
      streak,
    };
  });

  if (!timeline.length) {
    clearChart("Player has no match history.");
    return;
  }

  if (message) message.innerText = `${targetName} — winning/losing streak over time (positive = wins, negative = losses).`;
  const ctx = document.getElementById("streakTimeline").getContext("2d");
  if (CHARTS.streakTimeline) CHARTS.streakTimeline.destroy();
  CHARTS.streakTimeline = new Chart(ctx, {
    type: "line",
    data: {
      labels: timeline.map((t) => t.date),
      datasets: [
        {
          label: "Streak",
          data: timeline.map((t) => t.streak),
          borderColor: "#f97316",
          backgroundColor: "rgba(249,115,22,0.15)",
          borderWidth: 2,
          pointRadius: 3,
          tension: 0.25,
        },
      ],
    },
    options: {
      responsive: true,
      scales: {
        y: {
          suggestedMin: -5,
          suggestedMax: 5,
          ticks: { callback: (v) => v },
        },
      },
      plugins: {
        tooltip: {
          callbacks: {
            label: (ctx) => `Streak: ${ctx.parsed.y}`,
          },
        },
      },
    },
  });
}

function renderFatigueTimeline(rows, presetName) {
  const message = document.getElementById("fatigueTimelineMessage");
  const select = document.getElementById("playerFatigueSelect");
  const linkedSelects = [
    document.getElementById("playerSelect"),
    document.getElementById("playerStreakSelect"),
    document.getElementById("playerSurfaceSelect"),
  ];

  if (select && presetName) {
    select.value = presetName;
  }
  linkedSelects
    .filter(Boolean)
    .forEach((el) => {
      if (presetName) el.value = presetName;
    });

  const targetName = (presetName || (select && select.value) || "").trim();

  const clearChart = (text) => {
    if (message) message.innerText = text || "";
    if (CHARTS.fatigueTimeline) {
      CHARTS.fatigueTimeline.destroy();
      CHARTS.fatigueTimeline = null;
    }
  };

  if (!targetName) {
    clearChart("Select a player to see their fatigue timeline.");
    return;
  }

  const normTarget = targetName.toLowerCase();
  const matches = rows.filter((r) => {
    const p1 = (r.Player_1 || r.player_1 || "").toLowerCase();
    const p2 = (r.Player_2 || r.player_2 || "").toLowerCase();
    return p1 === normTarget || p2 === normTarget;
  });

  if (!matches.length) {
    clearChart("Player has no match history.");
    return;
  }

  const withDates = matches
    .map((m, idx) => ({
      ...m,
      _dateStr: m.match_date || m.Date || m.date,
      _date: new Date(m.match_date || m.Date || m.date),
      _ts: new Date(m.match_date || m.Date || m.date).getTime(),
      _idx: idx,
    }))
    .filter((m) => m._dateStr && !isNaN(m._date));

  const orderBroken = withDates.some((m, i) => {
    if (i === 0) return false;
    return withDates[i - 1]._date > m._date;
  });
  if (orderBroken) {
    console.error(`Match dates for ${targetName} are not sorted; re-sorting.`);
  }

  const sorted = withDates.sort((a, b) => a._ts - b._ts || a._idx - b._idx);
  const dayMs = 24 * 60 * 60 * 1000;

  let start7 = 0,
    start14 = 0,
    start30 = 0;

  const timeline = sorted.map((m, i) => {
    while (start7 < i && sorted[start7]._ts <= m._ts - 7 * dayMs) start7++;
    while (start14 < i && sorted[start14]._ts <= m._ts - 14 * dayMs) start14++;
    while (start30 < i && sorted[start30]._ts <= m._ts - 30 * dayMs) start30++;

    return {
      date: m._dateStr,
      fatigue_7d: i - start7,
      fatigue_14d: i - start14,
      fatigue_30d: i - start30,
    };
  });

  if (!timeline.length) {
    clearChart("Player has no match history.");
    return;
  }

  if (message)
    message.innerText = `${targetName} — matches played in the past 7/14/30 days before each match (excluding current).`;

  const ctx = document.getElementById("fatigueTimeline").getContext("2d");
  if (CHARTS.fatigueTimeline) CHARTS.fatigueTimeline.destroy();
  CHARTS.fatigueTimeline = new Chart(ctx, {
    type: "line",
    data: {
      labels: timeline.map((t) => t.date),
      datasets: [
        {
          label: "Matches last 7d",
          data: timeline.map((t) => t.fatigue_7d),
          borderColor: "#ef4444",
          backgroundColor: "rgba(239,68,68,0.12)",
          borderWidth: 2,
          tension: 0.3,
        },
        {
          label: "Matches last 14d",
          data: timeline.map((t) => t.fatigue_14d),
          borderColor: "#facc15",
          backgroundColor: "rgba(250,204,21,0.12)",
          borderWidth: 2,
          tension: 0.3,
        },
        {
          label: "Matches last 30d",
          data: timeline.map((t) => t.fatigue_30d),
          borderColor: "#3b82f6",
          backgroundColor: "rgba(59,130,246,0.12)",
          borderWidth: 2,
          tension: 0.3,
        },
      ],
    },
    options: {
      responsive: true,
      scales: { y: { beginAtZero: true, suggestedMax: 10 } },
      plugins: {
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y}`,
          },
        },
      },
    },
  });
}

function renderSurfaceTrendTimeline(rows, presetName) {
  const message = document.getElementById("surfaceTrendMessage");
  const select = document.getElementById("playerSurfaceSelect");
  const linkedSelects = [
    document.getElementById("playerSelect"),
    document.getElementById("playerStreakSelect"),
    document.getElementById("playerFatigueSelect"),
  ];

  if (select && presetName) {
    select.value = presetName;
  }
  linkedSelects
    .filter(Boolean)
    .forEach((el) => {
      if (presetName) el.value = presetName;
    });

  const targetName = (presetName || (select && select.value) || "").trim();

  const clearChart = (text) => {
    if (message) message.innerText = text || "";
    if (CHARTS.surfaceTrend) {
      CHARTS.surfaceTrend.destroy();
      CHARTS.surfaceTrend = null;
    }
  };

  if (!targetName) {
    clearChart("Select a player to see surface win-rate trends.");
    return;
  }

  const normTarget = targetName.toLowerCase();
  const matches = rows.filter((r) => {
    const p1 = (r.Player_1 || r.player_1 || "").toLowerCase();
    const p2 = (r.Player_2 || r.player_2 || "").toLowerCase();
    return p1 === normTarget || p2 === normTarget;
  });

  if (!matches.length) {
    clearChart("Player has no match history.");
    return;
  }

  const withDates = matches
    .map((m, idx) => ({
      ...m,
      _dateStr: m.match_date || m.Date || m.date,
      _date: new Date(m.match_date || m.Date || m.date),
      _ts: new Date(m.match_date || m.Date || m.date).getTime(),
      _idx: idx,
    }))
    .filter((m) => m._dateStr && !isNaN(m._date));

  const orderBroken = withDates.some((m, i) => {
    if (i === 0) return false;
    return withDates[i - 1]._date > m._date;
  });
  if (orderBroken) {
    console.error(`Match dates for ${targetName} are not sorted; re-sorting.`);
  }

  const sorted = withDates.sort((a, b) => a._ts - b._ts || a._idx - b._idx);
  const wins = {
    hard: [],
    clay: [],
    grass: [],
  };

  const timeline = sorted.map((m) => {
    const surface = (m.Surface || m.surface || "").toLowerCase();
    const winner = (m.Winner || m.winner || "").toLowerCase();
    const isWin = winner === normTarget;

    let hard = null,
      clay = null,
      grass = null;

    const computeRate = (arr) => {
      const window = arr.slice(Math.max(0, arr.length - 5));
      return Math.round((window.reduce((a, b) => a + b, 0) / window.length) * 100) / 100;
    };

    if (surface === "hard") {
      wins.hard.push(isWin ? 1 : 0);
      hard = computeRate(wins.hard);
    } else if (surface === "clay") {
      wins.clay.push(isWin ? 1 : 0);
      clay = computeRate(wins.clay);
    } else if (surface === "grass") {
      wins.grass.push(isWin ? 1 : 0);
      grass = computeRate(wins.grass);
    }

    return {
      date: m._dateStr,
      hard,
      clay,
      grass,
    };
  });

  const hasSeries = timeline.some((t) => [t.hard, t.clay, t.grass].some((v) => v !== null && !isNaN(v)));
  if (!hasSeries) {
    clearChart("Player has no match history on tracked surfaces.");
    return;
  }

  if (message)
    message.innerText = `${targetName} — rolling 5-match win rate by surface (hard/clay/grass).`;

  const ctx = document.getElementById("surfaceTrendTimeline").getContext("2d");
  if (CHARTS.surfaceTrend) CHARTS.surfaceTrend.destroy();
  CHARTS.surfaceTrend = new Chart(ctx, {
    type: "line",
    data: {
      labels: timeline.map((t) => t.date),
      datasets: [
        {
          label: "Hard (5-match WR)",
          data: timeline.map((t) => t.hard),
          borderColor: "#3b82f6",
          backgroundColor: "rgba(59,130,246,0.15)",
          borderWidth: 2,
          tension: 0.25,
          spanGaps: true,
        },
        {
          label: "Clay (5-match WR)",
          data: timeline.map((t) => t.clay),
          borderColor: "#ef4444",
          backgroundColor: "rgba(239,68,68,0.12)",
          borderWidth: 2,
          tension: 0.25,
          spanGaps: true,
        },
        {
          label: "Grass (5-match WR)",
          data: timeline.map((t) => t.grass),
          borderColor: "#22c55e",
          backgroundColor: "rgba(34,197,94,0.12)",
          borderWidth: 2,
          tension: 0.25,
          spanGaps: true,
        },
      ],
    },
    options: {
      responsive: true,
      scales: {
        y: { beginAtZero: true, max: 1, ticks: { callback: (v) => v.toFixed(2) } },
      },
      plugins: {
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${(ctx.parsed.y * 100).toFixed(1)}%`,
          },
        },
      },
    },
  });
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
