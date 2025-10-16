/* charts.js — EDA-only dashboard for WTA data.
 * Loads wta_data.csv using PapaParse and renders multiple EDA views.
 * Assumes columns: Date, Surface, Player_1, Player_2, y (+ many numeric features).
 */

// ---- Utilities
function parseDate(s){ const d=new Date(s); return isNaN(d)?null:d; }
function unique(a){ return Array.from(new Set(a)); }
function isFiniteNumber(x){ return typeof x==='number' && isFinite(x); }
function quantile(arr, q){
  const v = arr.slice().sort((a,b)=>a-b);
  const pos = (v.length-1)*q;
  const base = Math.floor(pos);
  const rest = pos-base;
  if(v[base+1]!==undefined) return v[base] + rest*(v[base+1]-v[base]);
  return v[base];
}
function hist(data, bins){
  const xs = data.filter(isFiniteNumber);
  if(xs.length===0) return {edges:[],counts:[]};
  const min = Math.min(...xs), max = Math.max(...xs);
  const edges = Array.from({length:bins+1}, (_,i)=> min + (i*(max-min))/bins);
  const counts = Array(bins).fill(0);
  for(const x of xs){
    let b = Math.floor((x-min)/(max-min+1e-12)*bins);
    if(b===bins) b=bins-1;
    counts[b]++;
  }
  return {edges,counts};
}

// Global
let DATA = [];
let NUMERIC_COLS = [];
let charts = {};

// ---- Filters and tabs
function filterData(){
  const yearSel = document.getElementById('year').value;
  const surfSel = document.getElementById('surface').value;
  return DATA.filter(r=>{
    const d = parseDate(r.Date);
    const okY = (yearSel==='All') || (d && d.getFullYear().toString()===yearSel);
    const okS = (surfSel==='All') || (String(r.Surface)===surfSel);
    return okY && okS;
  });
}
function switchTab(name){
  for(const id of ['overview','distributions','correlations','players','surfaces']){
    const el = document.getElementById('tab-'+id);
    if(!el) continue;
    el.style.display = (id===name)?'block':'none';
  }
  // refresh specific content on tab open
  if(name==='overview') renderOverview();
  if(name==='distributions') renderDistribution();
  if(name==='correlations') renderCorrelations();
  if(name==='players') renderPlayers();
  if(name==='surfaces') renderSurfaces();
}

// ---- Overview
function renderOverview(){
  const rows = filterData();
  document.getElementById('rows').textContent = rows.length.toLocaleString();
  document.getElementById('cols').textContent = Object.keys(rows[0]||{}).length;

  // dates
  const dates = rows.map(r=>parseDate(r.Date)).filter(Boolean).sort((a,b)=>a-b);
  const dateText = dates.length? `${dates[0].toISOString().slice(0,10)} → ${dates[dates.length-1].toISOString().slice(0,10)}` : '—';
  document.getElementById('dates').textContent = dateText;

  // class balance
  const y = rows.map(r=>Number(r.y)).filter(x=>x===0||x===1);
  const bal = y.length? (y.reduce((s,v)=>s+v,0)/y.length) : null;
  document.getElementById('balance').textContent = (bal!=null? bal.toFixed(3):'—');

  // missingness (top 12)
  const cols = Object.keys(rows[0]||{});
  const missCounts = cols.map(c=>{
    let m=0; for(const r of rows){ if(r[c]===null || r[c]===undefined || r[c]==='') m++; }
    return {col:c, miss:m};
  }).sort((a,b)=>b.miss-a.miss).slice(0,12);
  const mlabels = missCounts.map(x=>x.col);
  const mvals = missCounts.map(x=>x.miss);
  if(charts.missing) charts.missing.destroy();
  charts.missing = new Chart(document.getElementById('missingChart').getContext('2d'), {
    type: 'bar',
    data: { labels: mlabels, datasets:[{ label:'Missing', data: mvals }]},
    options: { responsive:true, maintainAspectRatio:false, scales:{ y:{ beginAtZero:true } } }
  });

  // matches per year
  const perYear = {};
  for(const r of rows){ const d=parseDate(r.Date); if(!d) continue; const y=d.getFullYear(); perYear[y]=(perYear[y]||0)+1; }
  const years = Object.keys(perYear).sort();
  const counts = years.map(y=>perYear[y]);
  if(charts.years) charts.years.destroy();
  charts.years = new Chart(document.getElementById('yearChart').getContext('2d'), {
    type: 'bar',
    data: { labels: years, datasets:[{ label:'Matches', data: counts }]},
    options: { responsive:true, maintainAspectRatio:false, scales:{ y:{ beginAtZero:true } } }
  });
}

// ---- Distributions
function populateFeatureList(){
  const sample = DATA[0] || {};
  const numeric = [];
  for(const k of Object.keys(sample)){
    // gather over many rows to be sure
    let isNum = true, checked=0;
    for(const r of DATA){
      const v = r[k];
      if(v===null || v===undefined || v==='') continue;
      if(!isFiniteNumber(v)) { isNum=false; break; }
      checked++; if(checked>50) break;
    }
    if(isNum) numeric.push(k);
  }
  NUMERIC_COLS = numeric;
  const sel = document.getElementById('feature');
  sel.innerHTML = numeric.map(c=>`<option value="${c}">${c}</option>`).join('');
}
function renderDistribution(){
  const rows = filterData();
  const feat = document.getElementById('feature').value || NUMERIC_COLS[0];
  const bins = Math.max(5, Math.min(100, parseInt(document.getElementById('bins').value||30)));

  const values = rows.map(r=>Number(r[feat])).filter(isFiniteNumber);
  const {edges,counts} = hist(values, bins);
  const centers = edges.slice(0,-1).map((e,i)=> (e+edges[i+1])/2);

  if(charts.hist) charts.hist.destroy();
  charts.hist = new Chart(document.getElementById('histChart').getContext('2d'), {
    type: 'bar',
    data: { labels: centers, datasets:[{ label: feat, data: counts }]},
    options: { responsive:true, maintainAspectRatio:false, scales:{ x:{ ticks:{callback:(v,idx)=>centers[idx].toFixed(2)} }, y:{ beginAtZero:true } } }
  });

  // Boxplot approximation (min, q1, median, q3, max)
  if(charts.box) charts.box.destroy();
  if(values.length){
    const q1=quantile(values,0.25), q2=quantile(values,0.5), q3=quantile(values,0.75);
    const min=Math.min(...values), max=Math.max(...values);
    charts.box = new Chart(document.getElementById('boxChart').getContext('2d'), {
      type: 'bar',
      data: { labels: [feat], datasets:[
        { label:'Min', data:[min] },
        { label:'Q1', data:[q1] },
        { label:'Median', data:[q2] },
        { label:'Q3', data:[q3] },
        { label:'Max', data:[max] },
      ]},
      options: { responsive:true, maintainAspectRatio:false, scales:{ y:{ beginAtZero:false } } }
    });
  }
}

// ---- Correlations (heatmap on canvas 2D)
function computeCorrelationMatrix(rows, cols){
  const n = cols.length;
  const mat = Array.from({length:n}, ()=> Array(n).fill(0));
  const colVals = cols.map(c => rows.map(r=>Number(r[c])).filter(isFiniteNumber));
  // align by index lengths: use pairwise over intersection by position (approximate for EDA)
  for(let i=0;i<n;i++){
    for(let j=i;j<n;j++){
      const a = colVals[i], b = colVals[j];
      const m = Math.min(a.length, b.length, 5000);
      if(m<20){ mat[i][j]=mat[j][i]=NaN; continue; }
      let sa=0,sb=0; for(let k=0;k<m;k++){ sa+=a[k]; sb+=b[k]; }
      const ma=sa/m, mb=sb/m;
      let cov=0, va=0, vb=0;
      for(let k=0;k<m;k++){ const da=a[k]-ma, db=b[k]-mb; cov+=da*db; va+=da*da; vb+=db*db; }
      const denom = Math.sqrt(va*vb);
      const r = denom>0 ? (cov/denom) : 0;
      mat[i][j]=mat[j][i]=r;
    }
  }
  return mat;
}
function renderHeatmapCanvas(canvas, labels, mat){
  const ctx = canvas.getContext('2d');
  const W = canvas.clientWidth, H = canvas.clientHeight;
  canvas.width = W; canvas.height = H;
  ctx.clearRect(0,0,W,H);
  const n = labels.length;
  if(n===0) return;
  const padL=120, padT=40;
  const gridW = W - padL - 20;
  const gridH = H - padT - 20;
  const cellW = gridW / n, cellH = gridH / n;
  // axes labels
  ctx.fillStyle = '#94a3b8';
  ctx.font = '12px Inter, sans-serif';
  for(let i=0;i<n;i++){
    // y labels
    ctx.fillText(labels[i], 10, padT + i*cellH + cellH*0.6);
    // x labels (rotated)
    ctx.save();
    ctx.translate(padL + i*cellW + cellW*0.5, 20);
    ctx.rotate(-Math.PI/4);
    ctx.fillText(labels[i], 0, 0);
    ctx.restore();
  }
  // cells
  for(let i=0;i<n;i++){
    for(let j=0;j<n;j++){
      let v = mat[i][j];
      if(!isFinite(v)) v=0;
      // color from blue (-1) to white (0) to red (+1)
      const r = v>0 ? Math.floor(255*v) : 0;
      const b = v<0 ? Math.floor(255*(-v)) : 0;
      const g = 40;
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(padL + j*cellW, padT + i*cellH, cellW, cellH);
    }
  }
}
function renderCorrelations(){
  const rows = filterData();
  const cols = NUMERIC_COLS.filter(c=>c!=='y'); // exclude target for cleaner view
  const maxCols = Math.min(cols.length, 18); // limit for readability
  const useCols = cols.slice(0, maxCols);
  const mat = computeCorrelationMatrix(rows, useCols);
  const canvas = document.getElementById('heatmap');
  renderHeatmapCanvas(canvas, useCols, mat);
}

// ---- Players
function renderPlayers(){
  const rows = filterData();
  // counts
  const cnt = {};
  for(const r of rows){
    cnt[r.Player_1] = (cnt[r.Player_1]||0)+1;
    cnt[r.Player_2] = (cnt[r.Player_2]||0)+1;
  }
  const top = Object.entries(cnt).sort((a,b)=>b[1]-a[1]).slice(0,10);
  if(charts.topMatches) charts.topMatches.destroy();
  charts.topMatches = new Chart(document.getElementById('topMatches').getContext('2d'), {
    type: 'bar', data: { labels: top.map(x=>x[0]), datasets:[{ label:'Matches', data: top.map(x=>x[1]) }]},
    options: { responsive:true, maintainAspectRatio:false, indexAxis:'y' }
  });

  // win rate (min 30 matches)
  const stats = {};
  for(const r of rows){
    const p1 = r.Player_1, p2 = r.Player_2, y = Number(r.y);
    if(!stats[p1]) stats[p1]={win:0, tot:0};
    if(!stats[p2]) stats[p2]={win:0, tot:0};
    stats[p1].win += (y===1?1:0); stats[p1].tot += 1;
    stats[p2].win += (y===0?1:0); stats[p2].tot += 1;
  }
  const wr = Object.entries(stats).filter(([k,v])=>v.tot>=30).map(([k,v])=>[k, v.win/v.tot, v.tot]);
  const topWr = wr.sort((a,b)=>b[1]-a[1]).slice(0,10);
  if(charts.topWins) charts.topWins.destroy();
  charts.topWins = new Chart(document.getElementById('topWins').getContext('2d'), {
    type: 'bar', data: { labels: topWr.map(x=>x[0]), datasets:[{ label:'Win rate', data: topWr.map(x=>x[1]) }]},
    options: { responsive:true, maintainAspectRatio:false, indexAxis:'y', scales:{ y:{ min:0, max:1 } } }
  });

  // sample table
  const tbody = document.querySelector('#sample tbody');
  tbody.innerHTML = '';
  const recent = rows.slice().sort((a,b)=> new Date(b.Date)-new Date(a.Date)).slice(0,20);
  for(const r of recent){
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${r.Date}</td><td>${r.Tournament||''}</td><td>${r.Surface||''}</td>
                    <td>${r.Player_1}</td><td>${r.Player_2}</td><td>${r.Winner||''}</td>`;
    tbody.appendChild(tr);
  }
}

// ---- Surfaces
function renderSurfaces(){
  const rows = filterData();
  const perSurf = {};
  for(const r of rows){
    const s = String(r.Surface||'Unknown');
    if(!perSurf[s]) perSurf[s]={win:0, tot:0};
    perSurf[s].win += Number(r.y)===1?1:0;
    perSurf[s].tot += 1;
  }
  const labels = Object.keys(perSurf);
  const wr = labels.map(s=> perSurf[s].win/perSurf[s].tot);
  const cnt = labels.map(s=> perSurf[s].tot);

  if(charts.surfWins) charts.surfWins.destroy();
  charts.surfWins = new Chart(document.getElementById('surfWins').getContext('2d'), {
    type: 'bar', data: { labels, datasets:[{ label:'Win rate (Player_1)', data: wr }]},
    options: { responsive:true, maintainAspectRatio:false, scales:{ y:{ min:0, max:1 } } }
  });

  if(charts.surfShare) charts.surfShare.destroy();
  charts.surfShare = new Chart(document.getElementById('surfShare').getContext('2d'), {
    type: 'pie', data: { labels, datasets:[{ label:'Matches', data: cnt }]},
    options: { responsive:true, maintainAspectRatio:false }
  });
}

// ---- UI init
function initUI(){
  // tabs
  document.querySelectorAll('button[data-tab]').forEach(btn=>{
    btn.addEventListener('click', ()=> switchTab(btn.dataset.tab));
  });

  // year options
  const years = unique(DATA.map(r=>{ const d=parseDate(r.Date); return d? d.getFullYear(): null; }).filter(Boolean)).sort((a,b)=>a-b);
  const yearSel = document.getElementById('year');
  yearSel.innerHTML = `<option value="All">All</option>` + years.map(y=>`<option value="${y}">${y}</option>`).join('');
  yearSel.addEventListener('change', ()=>{ renderOverview(); renderDistribution(); renderCorrelations(); renderPlayers(); renderSurfaces(); });

  // surface options
  const surfaces = unique(DATA.map(r=> String(r.Surface))).filter(Boolean);
  const surfSel = document.getElementById('surface');
  surfSel.innerHTML = `<option value="All">All</option>` + surfaces.map(s=>`<option value="${s}">${s}</option>`).join('');
  surfSel.addEventListener('change', ()=>{ renderOverview(); renderDistribution(); renderCorrelations(); renderPlayers(); renderSurfaces(); });

  // coverage pill
  const dates = DATA.map(r=>parseDate(r.Date)).filter(Boolean).sort((a,b)=>a-b);
  if(dates.length){
    document.getElementById('coverage').textContent = `Coverage: ${dates[0].toISOString().slice(0,10)} → ${dates[dates.length-1].toISOString().slice(0,10)} | ${DATA.length.toLocaleString()} rows`;
  } else {
    document.getElementById('coverage').textContent = `Rows: ${DATA.length.toLocaleString()}`;
  }

  // feature list
  populateFeatureList();

  // default tab
  switchTab('overview');
}

// ---- Load CSV and start
Papa.parse('./wta_data.csv', {
  header: true,
  dynamicTyping: true,
  download: true,
  complete: function(res){
    DATA = res.data.filter(r=> r && r.Date && r.Player_1 && r.Player_2);
    initUI();
  },
  error: function(err){
    console.error('CSV load failed', err);
    document.getElementById('coverage').textContent = 'Failed to load CSV';
  }
});
