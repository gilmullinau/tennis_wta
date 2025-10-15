// === Demo data (можно потом заменить на реальные JSON) ===
const years = [2018, 2019, 2020, 2021, 2022, 2023];
const hard = [1200, 1300, 400, 800, 1000, 1150];
const clay = [900, 950, 200, 600, 700, 850];
const grass = [250, 260, 50, 120, 180, 240];

// Chart 1: Matches by Year & Surface
Plotly.newPlot('chart1', [
  {x: years, y: hard, type: 'bar', name: 'Hard'},
  {x: years, y: clay, type: 'bar', name: 'Clay'},
  {x: years, y: grass, type: 'bar', name: 'Grass'}
], {barmode: 'group', template:'plotly_white'});

// Chart 2: Surface Distribution Pie
Plotly.newPlot('chart2', [{
  labels: ['Hard','Clay','Grass'],
  values: [55,30,15],
  type: 'pie'
}], {template:'plotly_white'});

// Chart 3: Rank difference scatter
const rankDiff = Array.from({length:200}, ()=>Math.random()*200-100);
const win = rankDiff.map(r=>r>0?0.7+Math.random()*0.3:Math.random()*0.5);
Plotly.newPlot('chart3', [{
  x: rankDiff, y: win, mode:'markers',
  marker:{color:'royalblue', opacity:0.6}
}], {template:'plotly_white'});
