async function loadData() {
  const response = await fetch("data/wta_data.csv");
  const text = await response.text();
  const rows = text.split("\n").map(r => r.split(","));
  const headers = rows[0];
  const data = rows.slice(1).map(r => Object.fromEntries(r.map((v, i) => [headers[i], v])));
  return data;
}

loadData().then(data => {
  // Helper: parse numbers
  data.forEach(d => {
    d.year = +d.year;
    d.Rank_1 = +d.Rank_1;
    d.Rank_2 = +d.Rank_2;
    d.Odd_1 = +d.Odd_1;
    d.Odd_2 = +d.Odd_2;
    d.y = +d.y;
  });

  // === Matches per Year ===
  const yearCounts = {};
  data.forEach(d => { yearCounts[d.year] = (yearCounts[d.year] || 0) + 1; });
  const years = Object.keys(yearCounts);
  const counts = Object.values(yearCounts);
  Plotly.newPlot("chart-year", [{
    x: years, y: counts, type: "bar", marker: { color: "#0083b0" }
  }], { title: "Matches per Year", template: "plotly_white" });

  // === Surface Distribution ===
  const surfaceCounts = {};
  data.forEach(d => { surfaceCounts[d.Surface] = (surfaceCounts[d.Surface] || 0) + 1; });
  Plotly.newPlot("chart-surface", [{
    labels: Object.keys(surfaceCounts),
    values: Object.values(surfaceCounts),
    type: "pie"
  }], { title: "Surface Distribution", template: "plotly_white" });

  // === Matches by Round ===
  const roundCounts = {};
  data.forEach(d => { roundCounts[d.Round] = (roundCounts[d.Round] || 0) + 1; });
  const roundKeys = Object.keys(roundCounts);
  const roundVals = Object.values(roundCounts);
  Plotly.newPlot("chart-round", [{
    x: roundKeys, y: roundVals, type: "bar", marker: { color: "#00b4db" }
  }], { title: "Matches by Round", template: "plotly_white" });

  // === Rank Difference vs Win Probability ===
  const rankDiff = data.map(d => d.Rank_2 - d.Rank_1);
  const y = data.map(d => d.y);
  Plotly.newPlot("chart-rankdiff", [{
    x: rankDiff, y: y, mode: "markers",
    marker: { color: "royalblue", opacity: 0.6 }
  }], { title: "Rank Difference vs Win (1 = Player 1 won)", template: "plotly_white" });

  // === Odds Distribution ===
  const odds1 = data.map(d => d.Odd_1);
  const odds2 = data.map(d => d.Odd_2);
  Plotly.newPlot("chart-odds", [
    { x: odds1, type: "histogram", name: "Odd_1", opacity: 0.6 },
    { x: odds2, type: "histogram", name: "Odd_2", opacity: 0.6 }
  ], { barmode: "overlay", title: "Odds Distribution", template: "plotly_white" });

  // === Correlation Heatmap ===
  const cols = ["Rank_1", "Rank_2", "Odd_1", "Odd_2", "y"];
  const matrix = cols.map(c1 =>
    cols.map(c2 => pearson(data.map(d => +d[c1]), data.map(d => +d[c2])))
  );
  Plotly.newPlot("chart-corr", [{
    z: matrix,
    x: cols,
    y: cols,
    type: "heatmap",
    colorscale: "Blues"
  }], { title: "Feature Correlation Matrix", template: "plotly_white" });
});

// Helper: Pearson correlation
function pearson(x, y) {
  const n = x.length;
  const meanX = x.reduce((a,b)=>a+b,0)/n;
  const meanY = y.reduce((a,b)=>a+b,0)/n;
  const num = x.map((v,i)=>(v-meanX)*(y[i]-meanY)).reduce((a,b)=>a+b,0);
  const den = Math.sqrt(x.map(v=>(v-meanX)**2).reduce((a,b)=>a+b,0) *
                        y.map(v=>(v-meanY)**2).reduce((a,b)=>a+b,0));
  return num/den;
}
