async function loadData() {
  const response = await fetch("data/wta_data.csv");
  const text = await response.text();
  const rows = text.split("\n").map(r => r.split(","));
  const headers = rows[0];
  const data = rows.slice(1).map(r => Object.fromEntries(r.map((v, i) => [headers[i], v])));
  return data;
}

loadData().then(data => {
  // ======== Data Cleaning & Feature Engineering ========
  const num = v => (v === "" || v === undefined || v === "NaN" || isNaN(v)) ? null : +v;

  data.forEach(d => {
    // Convert to numeric
    d.year = num(d.year);
    d.Rank_1 = num(d.Rank_1);
    d.Rank_2 = num(d.Rank_2);
    d.Pts_1 = num(d.Pts_1);
    d.Pts_2 = num(d.Pts_2);
    d.Odd_1 = num(d.Odd_1);
    d.Odd_2 = num(d.Odd_2);
    d.y = num(d.y);

    // Derived features
    d.rank_diff = (d.Rank_1 && d.Rank_2) ? d.Rank_2 - d.Rank_1 : null;
    d.odds_ratio = (d.Odd_1 && d.Odd_2) ? d.Odd_2 / d.Odd_1 : null;
    d.points_diff = (d.Pts_1 && d.Pts_2) ? d.Pts_2 - d.Pts_1 : null;
  });

  // ======== 1️⃣ Matches per Year ========
  const yearCounts = {};
  data.forEach(d => { if (d.year) yearCounts[d.year] = (yearCounts[d.year] || 0) + 1; });
  Plotly.newPlot("chart-year", [{
    x: Object.keys(yearCounts),
    y: Object.values(yearCounts),
    type: "bar",
    marker: { color: "#0083b0" }
  }], { title: "Matches per Year", template: "plotly_white" });

  // ======== 2️⃣ Surface Distribution ========
  const surfaceCounts = {};
  data.forEach(d => {
    if (d.Surface && d.Surface.trim() !== "")
      surfaceCounts[d.Surface] = (surfaceCounts[d.Surface] || 0) + 1;
  });
  Plotly.newPlot("chart-surface", [{
    labels: Object.keys(surfaceCounts),
    values: Object.values(surfaceCounts),
    type: "pie"
  }], { title: "Surface Distribution", template: "plotly_white" });

  // ======== 3️⃣ Matches by Round ========
  const roundCounts = {};
  data.forEach(d => {
    if (d.Round && d.Round.trim() !== "" && d.Round !== "undefined") {
      roundCounts[d.Round] = (roundCounts[d.Round] || 0) + 1;
    }
  });
  Plotly.newPlot("chart-round", [{
    x: Object.keys(roundCounts),
    y: Object.values(roundCounts),
    type: "bar",
    marker: { color: "#00b4db" }
  }], { title: "Matches by Round", template: "plotly_white" });

  // ======== 4️⃣ Rank Difference vs Win Probability ========
  const rankDiff = data.map(d => d.rank_diff).filter(v => v !== null);
  const y = data.map(d => d.y).filter(v => v !== null);
  Plotly.newPlot("chart-rankdiff", [{
    x: rankDiff,
    y: y,
    mode: "markers",
    marker: { color: "royalblue", opacity: 0.6 }
  }], { title: "Rank Difference vs Win (1 = Player 1 won)", template: "plotly_white" });

  // ======== 5️⃣ Odds Distribution ========
  const odds1 = data.map(d => d.Odd_1).filter(v => v !== null);
  const odds2 = data.map(d => d.Odd_2).filter(v => v !== null);
  Plotly.newPlot("chart-odds", [
    { x: odds1, type: "histogram", name: "Odd_1", opacity: 0.6 },
    { x: odds2, type: "histogram", name: "Odd_2", opacity: 0.6 }
  ], { barmode: "overlay", title: "Odds Distribution", template: "plotly_white" });

  // ======== 6️⃣ Derived Feature Distributions ========
  const oddsRatio = data.map(d => d.odds_ratio).filter(v => v !== null);
  const pointsDiff = data.map(d => d.points_diff).filter(v => v !== null);
  Plotly.newPlot("chart-derived", [
    { x: rankDiff, type: "histogram", name: "Rank Diff", opacity: 0.6 },
    { x: oddsRatio, type: "histogram", name: "Odds Ratio", opacity: 0.6 },
    { x: pointsDiff, type: "histogram", name: "Points Diff", opacity: 0.6 }
  ], { barmode: "overlay", title: "Derived Feature Distributions", template: "plotly_white" });

  // ======== 7️⃣ Correlation Heatmap ========
  const clean = data.filter(d =>
    d.Rank_1 !== null && d.Rank_2 !== null &&
    d.Odd_1 !== null && d.Odd_2 !== null &&
    d.y !== null && d.rank_diff !== null &&
    d.odds_ratio !== null && d.points_diff !== null
  );

  const cols = ["Rank_1", "Rank_2", "Odd_1", "Odd_2", "y", "rank_diff", "odds_ratio", "points_diff"];
  const matrix = cols.map(c1 =>
    cols.map(c2 => pearson(clean.map(d => +d[c1]), clean.map(d => +d[c2])))
  );

  Plotly.newPlot("chart-corr", [{
    z: matrix,
    x: cols,
    y: cols,
    type: "heatmap",
    colorscale: "Blues"
  }], { title: "Feature Correlation Matrix", template: "plotly_white" });
});

// ======== Helper: Pearson correlation ========
function pearson(x, y) {
  const valid = x.map((v, i) => [v, y[i]]).filter(([a, b]) => a !== null && b !== null && !isNaN(a) && !isNaN(b));
  if (valid.length === 0) return 0;
  const [xs, ys] = [valid.map(d => d[0]), valid.map(d => d[1])];
  const n = xs.length;
  const meanX = xs.reduce((a,b)=>a+b,0)/n;
  const meanY = ys.reduce((a,b)=>a+b,0)/n;
  const num = xs.map((v,i)=>(v-meanX)*(ys[i]-meanY)).reduce((a,b)=>a+b,0);
  const den = Math.sqrt(xs.map(v=>(v-meanX)**2).reduce((a,b)=>a+b,0) *
                        ys.map(v=>(v-meanY)**2).reduce((a,b)=>a+b,0));
  return den === 0 ? 0 : num/den;
}
