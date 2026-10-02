// Scatterplot of any two variables for tracts in scope (requirement R4).
// Points are drawn on a canvas (fast for thousands of points); axes are SVG.
// Hover and click use a Delaunay triangulation to find the nearest point quickly.
/* global d3 */
import { state, set, subscribe, touches } from "./store.js";
import { passesBrushes, fmt, tractName } from "./data.js";
import { tooltip } from "./tooltip.js";


export function initScatter(data, el, rEl) {
  const width = 560, height = 400, m = { top: 12, right: 16, bottom: 44, left: 52 };
  const wrap = d3.select(el).append("div").attr("class", "layered").style("aspect-ratio", `${width} / ${height}`);
  const canvas = wrap.append("canvas").node();
  const svg = wrap.append("svg").attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "img").attr("aria-label", "Scatterplot comparing two measures across tracts");
  const gx = svg.append("g").attr("transform", `translate(0,${height - m.bottom})`);
  const gy = svg.append("g").attr("transform", `translate(${m.left},0)`);
  const xLabel = svg.append("text").attr("class", "axis-label").attr("x", width - m.right).attr("y", height - 8).attr("text-anchor", "end");
  const yLabel = svg.append("text").attr("class", "axis-label").attr("x", m.left).attr("y", m.top - 2).attr("dy", "0.8em").attr("dx", 6);
  const marks = svg.append("g");
  const hit = svg.append("rect").attr("x", m.left).attr("y", m.top)
    .attr("width", width - m.left - m.right).attr("height", height - m.top - m.bottom)
    .attr("fill", "transparent");

  let pts = [], delaunay = null, x, y;

  function render() {
    const scoped = data.tracts.filter((t) => data.inScope(t, state.scope));
    pts = scoped
      .map((t) => ({ t, vx: data.value(t, state.scatterX), vy: data.value(t, state.scatterY) }))
      .filter((p) => p.vx != null && p.vy != null);
    x = d3.scaleLinear().domain(d3.extent(pts, (p) => p.vx)).nice().range([m.left, width - m.right]);
    y = d3.scaleLinear().domain(d3.extent(pts, (p) => p.vy)).nice().range([height - m.bottom, m.top]);
    gx.call(d3.axisBottom(x).ticks(6));
    gy.call(d3.axisLeft(y).ticks(6));
    xLabel.text(data.label(state.scatterX));
    yLabel.text(data.label(state.scatterY));
    delaunay = d3.Delaunay.from(pts, (p) => x(p.vx), (p) => y(p.vy));

    // Draw on canvas at device resolution
    const ratio = window.devicePixelRatio || 1;
    canvas.width = width * ratio; canvas.height = height * ratio;
    const ctx = canvas.getContext("2d");
    ctx.scale(ratio, ratio);
    const r = pts.length > 1500 ? 1.8 : 3.2;
    const passing = (p) => passesBrushes(data, p.t, state.brushes);
    for (const pass of [false, true]) {
      ctx.fillStyle = pass ? "rgba(23, 74, 99, 0.55)" : "rgba(120, 130, 125, 0.18)";
      ctx.beginPath();
      for (const p of pts) {
        if (passing(p) !== pass) continue;
        ctx.moveTo(x(p.vx) + r, y(p.vy));
        ctx.arc(x(p.vx), y(p.vy), r, 0, 2 * Math.PI);
      }
      ctx.fill();
    }

    // Pearson correlation among points that pass the brushes
    const shown = pts.filter(passing);
    const rVal = pearson(shown.map((p) => p.vx), shown.map((p) => p.vy));
    d3.select(rEl).text(rVal == null ? "" :
      `Correlation r = ${rVal.toFixed(2)} across ${fmt.int(shown.length)} tracts. Correlation in modeled estimates does not show cause.`);
    drawMarks();
  }

  function drawMarks() {
    const byId = new Map(pts.map((p) => [p.t.id, p]));
    const items = [
      ...(state.peers || []).map((id) => ({ id, cls: "peer" })),
      ...(state.selected ? [{ id: state.selected, cls: "selected" }] : []),
      ...(state.hovered ? [{ id: state.hovered, cls: "hovered" }] : []),
    ].filter((d) => byId.has(d.id));
    marks.selectAll("circle").data(items, (d) => d.cls + d.id).join("circle")
      .attr("class", (d) => `mark ${d.cls}`)
      .attr("cx", (d) => x(byId.get(d.id).vx))
      .attr("cy", (d) => y(byId.get(d.id).vy))
      .attr("r", (d) => (d.cls === "selected" ? 6 : 5));
  }

  function nearest(event) {
    if (!pts.length) return null;
    const [mx, my] = d3.pointer(event, svg.node());
    const p = pts[delaunay.find(mx, my)];
    return Math.hypot(x(p.vx) - mx, y(p.vy) - my) < 12 ? p : null;
  }

  hit.on("pointermove", (event) => {
    const p = nearest(event);
    set({ hovered: p ? p.t.id : null });
    if (p) {
      tooltip.show(event, `<strong>${tractName(p.t)}</strong><br>${data.label(state.scatterX)}: ${fmt.pct(p.vx)}<br>${data.label(state.scatterY)}: ${fmt.pct(p.vy)}`);
    } else tooltip.hide();
  })
    .on("pointerleave", () => { set({ hovered: null }); tooltip.hide(); })
    .on("click", (event) => {
      const p = nearest(event);
      if (p) set({ selected: p.t.id });
    });

  subscribe((changed) => {
    if (touches(changed, "scope", "scatterX", "scatterY", "brushes")) render();
    else if (touches(changed, "selected", "hovered", "peers")) drawMarks();
  });
  render();
}

function pearson(a, b) {
  const n = a.length;
  if (n < 3) return null;
  const ma = d3.mean(a), mb = d3.mean(b);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : null;
}
