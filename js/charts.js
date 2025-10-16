/* charts.js — loads wta_data.csv and renders metrics + charts using Chart.js
 * Expected columns: Date, Surface, Player_1, Player_2, Winner, y, Odd_1, Odd_2
 * Optional engineered features are ignored here.
 */

// Helpers
function parseDate(s) { const d = new Date(s); return isNaN(d) ? null : d; }
function unique(arr) { return Array.from(new Set(arr)); }
function toFixed(val, n=3) { return (val != null && isFinite(val)) ? Number(val).toFixed(n) : '—'; }
function rocAucScore(y, p) {
  // Sort by predicted prob descending
  const pairs = y.map((yy, i) => [p[i], yy]).sort((a,b)=>b[0]-a[0]);
  let tp=0, fp=0, tn=0, fn=0;
  const P = y.reduce((s,v)=>s+(v===1?1:0),0);
  const N = y.length - P;
  let auc = 0, prevFpr = 0, prevTpr = 0;
  let lastScore = null;
  let tpCount = 0, fpCount = 0;
  for (const [score, label] of pairs) {
    if (lastScore !== null && score !== lastScore) {
      const tpr = tpCount / P;
      const fpr = fpCount / N;
      auc += (fpr - prevFpr) * (tpr + prevTpr) / 2;
      prevFpr = fpr; prevTpr = tpr;
    }
    if (label === 1) tpCount++; else fpCount++;
    lastScore = score;
  }
  const tpr = tpCount / P;
  const fpr = fpCount / N;
  auc += (fpr - prevFpr) * (tpr + prevTpr) / 2;
  return auc;
}

function logLoss(y, p, eps=1e-15) {
  let s = 0; const n = y.length;
  for (let i=0;i<n;i++) {
    const pi = Math.min(1-eps, Math.max(eps, p[i]));
    s += - (y[i]===1 ? Math.log(pi) : Math.log(1-pi));
  }
  return s/n;
}
function brier(y, p) {
  let s = 0; const n = y.length;
  for (let i=0;i<n;i++) { const d = (p[i] - (y[i]===1?1:0)); s += d*d; }
  return s/n;
}
function impliedProb(o1, o2) {
  const p1 = 1/parseFloat(o1), p2 = 1/parseFloat(o2);
  if (!isFinite(p1) || !isFinite(p2)) return null;
  const s = p1 + p2; return p1/s;
}

// Global state
let DATA = [];
let rocChart, calibChart, timeChart, playerChart;

function filterData() {
  const yearSel = document.getElementById('year').value;
  const surfaceSel = document.getElementById('surface').value;
  return DATA.filter(r => {
    const d = parseDate(r.Date);
    const okYear = (yearSel === 'All') || (d && d.getFullYear().toString() === yearSel);
    const okSurf = (surfaceSel === 'All') || (String(r.Surface) === surfaceSel);
    return okYear && okSurf;
  });
}

function refresh() {
  const filtered = filterData();
  // Build vectors
  const y = [], p = [], dates = [];
  for (const r of filtered) {
    const prob = impliedProb(r.Odd_1, r.Odd_2);
    if (prob != null && r.y !== '' && r.y !== null && r.y !== undefined) {
      y.push(Number(r.y));
      p.push(prob);
      dates.push(parseDate(r.Date));
    }
  }

  // Metrics
  const auc = (y.length>0) ? rocAucScore(y, p) : null;
  const ll = (y.length>0) ? logLoss(y, p) : null;
  const br = (y.length>0) ? brier(y, p) : null;
  const bal = (y.length>0) ? y.reduce((s,v)=>s+v,0)/y.length : null;
  document.getElementById('auc').textContent = toFixed(auc);
  document.getElementById('logloss').textContent = toFixed(ll);
  document.getElementById('brier').textContent = toFixed(br);
  document.getElementById('balance').textContent = toFixed(bal);

  // ROC points (threshold sweep)
  const pairs = y.map((yy,i)=>[p[i], yy]).sort((a,b)=>b[0]-a[0]);
  const P = y.reduce((s,v)=>s+(v===1?1:0),0);
  const N = y.length - P;
  let tp=0, fp=0;
  const rocX=[], rocY=[];
  let last = null;
  for (const [score,label] of pairs) {
    if (last!==null && score!==last) {
      rocX.push(fp/N); rocY.push(tp/P);
    }
    if (label===1) tp++; else fp++;
    last=score;
  }
  rocX.push(fp/N); rocY.push(tp/P);

  // Calibration bins
  const bins = 10;
  const binSums = Array(bins).fill(0);
  const binCounts = Array(bins).fill(0);
  for (let i=0;i<p.length;i++) {
    let b = Math.min(bins-1, Math.max(0, Math.floor(p[i]*bins)));
    binSums[b] += y[i];
    binCounts[b] += 1;
  }
  const calibX = [], calibY = [];
  for (let b=0;b<bins;b++) {
    if (binCounts[b] > 0) {
      calibX.push((b+0.5)/bins);
      calibY.push(binSums[b]/binCounts[b]);
    }
  }

  // Time chart (monthly win rate of Player_1)
  const monthly = {};
  for (let i=0;i<filtered.length;i++) {
    const d = parseDate(filtered[i].Date); if (!d) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    if (!monthly[key]) monthly[key] = {win:0, tot:0};
    monthly[key].win += Number(filtered[i].y);
    monthly[key].tot += 1;
  }
  const months = Object.keys(monthly).sort();
  const wr = months.map(m => monthly[m].win / monthly[m].tot);

  // Player explorer rolling win rate
  const q = document.getElementById('player').value.trim().toLowerCase();
  const plRows = q ? DATA.filter(r => String(r.Player_1).toLowerCase().includes(q) || String(r.Player_2).toLowerCase().includes(q)) : [];
  const sortedPl = plRows.sort((a,b)=> new Date(a.Date) - new Date(b.Date));
  const roll = [];
  const window = 10;
  let wins = 0, buf = [];
  for (const r of sortedPl) {
    const meIsP1 = String(r.Player_1).toLowerCase().includes(q);
    const y1 = Number(r.y);
    const win = meIsP1 ? y1 : (1 - y1);
    buf.push(win); wins += win;
    if (buf.length > window) wins -= buf.shift();
    roll.push(buf.length >= window ? wins / buf.length : null);
  }

  // Update charts
  if (rocChart) rocChart.destroy();
  if (calibChart) calibChart.destroy();
  if (timeChart) timeChart.destroy();
  if (playerChart) playerChart.destroy();

  rocChart = new Chart(document.getElementById('rocChart').getContext('2d'), {
    type: 'line',
    data: { labels: rocX, datasets: [{ label: 'ROC', data: rocY, fill: false }]},
    options: { responsive:true, maintainAspectRatio:false, scales: { x: { title:{display:true, text:'FPR'} }, y: { title:{display:true, text:'TPR'}, min:0, max:1 } } }
  });

  calibChart = new Chart(document.getElementById('calibChart').getContext('2d'), {
    type: 'line',
    data: { labels: calibX, datasets: [{ label: 'Observed', data: calibY, fill:false }, { label: 'Ideal', data: calibX, fill:false }]},
    options: { responsive:true, maintainAspectRatio:false, scales: { x: { title:{display:true, text:'Predicted probability'} }, y: { title:{display:true, text:'Observed frequency'}, min:0, max:1 } } }
  });

  timeChart = new Chart(document.getElementById('timeChart').getContext('2d'), {
    type: 'line',
    data: { labels: months, datasets: [{ label: 'Win rate (Player_1)', data: wr, fill: false }]},
    options: { responsive:true, maintainAspectRatio:false, scales: { y: { min:0, max:1 } } }
  });

  playerChart = new Chart(document.getElementById('playerChart').getContext('2d'), {
    type: 'line',
    data: { labels: sortedPl.map(r=>r.Date), datasets: [{ label: 'Rolling win% (10)', data: roll, fill:false }]},
    options: { responsive:true, maintainAspectRatio:false, scales: { y: { min:0, max:1 } } }
  });

  // H2H table (recent 20 matches under filters)
  const tbody = document.querySelector('#h2h tbody');
  tbody.innerHTML = '';
  const recent = filtered.slice().sort((a,b)=> new Date(b.Date) - new Date(a.Date)).slice(0, 20);
  for (const r of recent) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${r.Date}</td><td>${r.Tournament||''}</td><td>${r.Surface||''}</td>
                    <td>${r.Player_1}</td><td>${r.Player_2}</td><td>${r.Winner||''}</td>
                    <td>${r.Odd_1||''}</td><td>${r.Odd_2||''}</td>`;
    tbody.appendChild(tr);
  }
}

function initUI() {
  // Year options
  const years = unique(DATA.map(r => { const d = parseDate(r.Date); return d ? d.getFullYear() : null; }).filter(Boolean)).sort((a,b)=>a-b);
  const yearSel = document.getElementById('year');
  yearSel.innerHTML = `<option value="All">All</option>` + years.map(y => `<option value="${y}">${y}</option>`).join('');

  // Surface options
  const surfaces = ['All'].concat(unique(DATA.map(r => String(r.Surface))).filter(Boolean));
  const surfSel = document.getElementById('surface');
  surfSel.innerHTML = surfaces.map(s=>`<option value="${s}">${s}</option>`).join('');

  // Coverage pill
  const dates = DATA.map(r => parseDate(r.Date)).filter(Boolean).sort((a,b)=>a-b);
  if (dates.length) {
    const min = dates[0].toISOString().slice(0,10);
    const max = dates[dates.length-1].toISOString().slice(0,10);
    document.getElementById('coverage').textContent = `Coverage: ${min} → ${max} | ${DATA.length.toLocaleString()} rows`;
  } else {
    document.getElementById('coverage').textContent = `Rows: ${DATA.length.toLocaleString()}`;
  }

  document.getElementById('year').addEventListener('change', refresh);
  document.getElementById('surface').addEventListener('change', refresh);
  document.getElementById('player').addEventListener('input', () => { refresh(); });
}

// Load CSV
Papa.parse('./wta_data.csv', {
  header: true,
  dynamicTyping: true,
  download: true,
  complete: function(res) {
    DATA = res.data.filter(r => r && r.Date && r.Player_1 && r.Player_2);
    initUI();
    refresh();
  },
  error: function(err) {
    console.error('Failed to load CSV', err);
    document.getElementById('coverage').textContent = 'Failed to load CSV';
  }
});
