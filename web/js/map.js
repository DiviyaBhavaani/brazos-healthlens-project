// Choropleth map of census tracts (requirements R1, R5, R7).
// - Color shows the chosen measure, CI width, cluster, or outlier score.
// - Tracts outside the scope are drawn pale for context; tracts that fail a
//   parallel-coordinate brush fade out (brushing and linking).
// - The selected tract and its peers are outlined in the accent color.
/* global d3 */
import { state, set, subscribe, touches } from "./store.js";
import { passesBrushes, fmt, tractName } from "./data.js";
import { tooltip } from "./tooltip.js";

export const CLUSTER_COLORS = ["#56B4E9", "#009E73", "#E69F00", "#D55E00", "#0072B2", "#CC79A7", "#F0E442", "#999999"];
const OUT_OF_SCOPE = "#e3e7e4";

export function initMap(data, el, legendEl) {
  const width = 900, height = 760;
  const svg = d3.select(el).append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "img")
    .attr("aria-label", "Map of Texas census tracts colored by the selected measure");

  // Hatch pattern for low-confidence tracts
  svg.append("defs").append("pattern")
    .attr("id", "hatch").attr("width", 4).attr("height", 4)
    .attr("patternUnits", "userSpaceOnUse").attr("patternTransform", "rotate(45)")
    .call((p) => {
      p.append("rect").attr("width", 4).attr("height", 4).attr("fill", "#f3f4f2");
      p.append("line").attr("y2", 4).attr("stroke", "#9aa39d").attr("stroke-width", 1.2);
    });

  const projection = d3.geoConicEqualArea().parallels([27.5, 35]).rotate([100, 0])
    .fitExtent([[10, 10], [width - 10, height - 10]], { type: "FeatureCollection", features: data.features });
  const path = d3.geoPath(projection);

  const root = svg.append("g");
  const tractLayer = root.append("g");
  const outlineLayer = root.append("g").attr("pointer-events", "none");

  const tractPaths = tractLayer.selectAll("path")
    .data(data.features, (d) => d.id)
    .join("path")
    .attr("d", path)
    .attr("class", "tract")
    .on("pointermove", (event, f) => {
      const t = data.tractById.get(f.id);
      if (!t) return;
      if (state.hovered !== f.id) set({ hovered: f.id });
      tooltip.show(event, tooltipHtml(t));
    })
    .on("pointerleave", () => { set({ hovered: null }); tooltip.hide(); })
    .on("click", (event, f) => set({ selected: state.selected === f.id ? null : f.id }));

  const zoom = d3.zoom().scaleExtent([1, 60]).on("zoom", (e) => {
    root.attr("transform", e.transform);
    outlineLayer.selectAll("path").attr("stroke-width", 2 / e.transform.k);
  });
  svg.call(zoom).on("dblclick.zoom", null);

  function tooltipHtml(t) {
    const i = data.measureIndex.get(state.measure);
    const ci = t.lo[i] != null ? ` <span class="muted">(${fmt.pct(t.lo[i])}–${fmt.pct(t.hi[i])})</span>` : "";
    return `<strong>${tractName(t)}</strong><br>${data.label(state.measure)}: ${fmt.pct(t.v[i])}%${ci}` +
      `<br><span class="muted">${data.clusterLabel(t.k)}</span>`;
  }

  function colorScale() {
    const scoped = data.tracts.filter((t) => data.inScope(t, state.scope));
    const i = data.measureIndex.get(state.measure);
    if (state.colorMode === "cluster") {
      return { fn: (t) => CLUSTER_COLORS[t.k % CLUSTER_COLORS.length], kind: "cluster" };
    }
    if (state.colorMode === "outlier") {
      const s = d3.scaleSequential(d3.interpolateYlOrRd).domain([0.5, 1]).clamp(true);
      return { fn: (t) => s(t.o), kind: "seq", scale: s, title: "Outlier score (percentile distance from group centre)", fmt: d3.format(".0%") };
    }
    if (state.colorMode === "uncertainty") {
      const width = (t) => (t.hi[i] == null ? null : t.hi[i] - t.lo[i]);
      const vals = scoped.map(width).filter((v) => v != null).sort(d3.ascending);
      const s = d3.scaleSequential(d3.interpolatePuBu)
        .domain([d3.quantile(vals, 0.02), d3.quantile(vals, 0.98)]).clamp(true);
      return { fn: (t) => (width(t) == null ? "#ccc" : s(width(t))), kind: "seq", scale: s,
        title: `95% CI width, ${data.label(state.measure)} (percentage points)`, fmt: fmt.pct };
    }
    // Domain uses the 2nd-98th percentile of in-scope tracts so a few extreme
    // tracts don't wash out local contrast.
    const vals = scoped.map((t) => t.v[i]).filter((v) => v != null).sort(d3.ascending);
    const s = d3.scaleSequential(d3.interpolateYlGnBu)
      .domain([d3.quantile(vals, 0.02), d3.quantile(vals, 0.98)]).clamp(true);
    return { fn: (t) => (t.v[i] == null ? "#ccc" : s(t.v[i])), kind: "seq", scale: s,
      title: `${data.label(state.measure)} (% of adults)`, fmt: fmt.pct };
  }

  function recolor() {
    const c = colorScale();
    tractPaths
      .attr("fill", (f) => {
        const t = data.tractById.get(f.id);
        if (!t || !data.inScope(t, state.scope)) return OUT_OF_SCOPE;
        if (state.hideLowConf && state.colorMode === "value" && data.lowConfidence(t, state.measure)) return "url(#hatch)";
        return c.fn(t);
      })
      .attr("fill-opacity", (f) => {
        const t = data.tractById.get(f.id);
        if (!t || !data.inScope(t, state.scope)) return 1;
        return passesBrushes(data, t, state.brushes) ? 1 : 0.15;
      });
    drawLegend(c);
  }

  function drawOutlines() {
    const items = [];
    for (const id of state.peers || []) items.push({ id, cls: "peer" });
    if (state.selected) items.push({ id: state.selected, cls: "selected" });
    if (state.hovered) items.push({ id: state.hovered, cls: "hovered" });
    const featureById = new Map(data.features.map((f) => [f.id, f]));
    const k = d3.zoomTransform(svg.node()).k;
    outlineLayer.selectAll("path")
      .data(items.filter((d) => featureById.has(d.id)), (d) => d.cls + d.id)
      .join("path")
      .attr("d", (d) => path(featureById.get(d.id)))
      .attr("class", (d) => `outline ${d.cls}`)
      .attr("stroke-width", 2 / k);
  }

  function zoomToScope() {
    const feats = data.features.filter((f) => {
      const t = data.tractById.get(f.id);
      return t && data.inScope(t, state.scope);
    });
    if (!feats.length) return;
    const [[x0, y0], [x1, y1]] = path.bounds({ type: "FeatureCollection", features: feats });
    const k = Math.min(60, 0.9 / Math.max((x1 - x0) / width, (y1 - y0) / height));
    const t = d3.zoomIdentity.translate(width / 2, height / 2).scale(k).translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    svg.transition().duration(reduce ? 0 : 750).call(zoom.transform, t);
  }

  function drawLegend(c) {
    const lg = d3.select(legendEl);
    lg.selectAll("*").remove();
    if (c.kind === "cluster") {
      lg.append("p").attr("class", "legend-title").text("Health profile groups (k-means on all measures)");
      const items = lg.append("ul").attr("class", "swatches");
      data.clusters.forEach((cl) => {
        const li = items.append("li");
        li.append("span").attr("class", "swatch").style("background", CLUSTER_COLORS[cl.id % CLUSTER_COLORS.length]);
        li.append("span").text(`${data.clusterLabel(cl.id)} (${fmt.int(cl.n)} tracts)`);
      });
      return;
    }
    lg.append("p").attr("class", "legend-title").text(c.title);
    const w = 260, h = 10;
    const s = lg.append("svg").attr("viewBox", `0 0 ${w + 20} 34`).attr("class", "ramp");
    const [d0, d1] = c.scale.domain();
    const id = "ramp-grad";
    const grad = s.append("defs").append("linearGradient").attr("id", id);
    d3.range(0, 1.01, 0.1).forEach((p) => grad.append("stop").attr("offset", p).attr("stop-color", c.scale(d0 + p * (d1 - d0))));
    s.append("rect").attr("x", 10).attr("width", w).attr("height", h).attr("fill", `url(#${id})`);
    const ax = d3.scaleLinear().domain([d0, d1]).range([10, 10 + w]);
    s.append("g").attr("transform", `translate(0,${h})`).call(d3.axisBottom(ax).ticks(5).tickFormat(c.fmt).tickSize(4))
      .call((g) => g.select(".domain").remove());
    if (state.hideLowConf && state.colorMode === "value") {
      lg.append("p").attr("class", "legend-note")
        .html('<span class="swatch hatch"></span> Low confidence: widest 10% of confidence intervals for this measure');
    }
  }

  subscribe((changed) => {
    if (touches(changed, "measure", "colorMode", "hideLowConf", "brushes", "scope")) recolor();
    if (touches(changed, "selected", "hovered", "peers")) drawOutlines();
    if (touches(changed, "scope")) zoomToScope();
  });

  recolor();
  drawOutlines();
  zoomToScope();
}
