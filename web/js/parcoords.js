// Parallel coordinates (requirements R2, R6): one vertical axis per measure,
// one line per tract in scope. Drag on an axis to brush a range; tracts outside
// any brush fade in every view. Lines are canvas; axes and brushes are SVG.
/* global d3 */
import { state, set, subscribe, touches } from "./store.js";
import { passesBrushes } from "./data.js";

export function initParcoords(data, el) {
  const width = 1200, height = 330, m = { top: 46, right: 60, bottom: 16, left: 60 };
  const wrap = d3.select(el).append("div").attr("class", "layered").style("aspect-ratio", `${width} / ${height}`);
  const canvas = wrap.append("canvas").node();
  const svg = wrap.append("svg").attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "img").attr("aria-label", "Parallel coordinates of selected measures; drag on an axis to filter");
  let axesG = svg.append("g");
  let x, ys;

  function layout() {
    x = d3.scalePoint().domain(state.axes).range([m.left, width - m.right]);
    // Each axis spans the full Texas range so brushes keep their meaning across scopes.
    ys = new Map(state.axes.map((id) => {
      const i = data.measureIndex.get(id);
      return [id, d3.scaleLinear().domain(data.stats[i].extent).nice().range([height - m.bottom, m.top])];
    }));
  }

  function drawAxes() {
    axesG.remove();
    axesG = svg.append("g");
    const axis = axesG.selectAll("g.pc-axis").data(state.axes).join("g")
      .attr("class", "pc-axis").attr("transform", (id) => `translate(${x(id)},0)`);
    axis.each(function (id) { d3.select(this).call(d3.axisLeft(ys.get(id)).ticks(5).tickSize(3)); });
    axis.append("text").attr("class", "pc-label").attr("y", m.top - 30).attr("text-anchor", "middle")
      .text((id) => short(data.label(id)))
      .append("title").text((id) => `${data.label(id)} (% of adults)`);
    axis.append("text").attr("class", "pc-unit").attr("y", m.top - 16).attr("text-anchor", "middle").text("%");

    axis.append("g").attr("class", "brush").each(function (id) {
      const b = d3.brushY().extent([[-10, m.top], [10, height - m.bottom]])
        .on("end", (event) => {
          if (!event.sourceEvent) return; // ignore programmatic moves
          const brushes = { ...state.brushes };
          if (event.selection) brushes[id] = event.selection.map(ys.get(id).invert).sort(d3.ascending);
          else delete brushes[id];
          set({ brushes });
        });
      const g = d3.select(this).call(b);
      if (state.brushes[id]) g.call(b.move, state.brushes[id].map(ys.get(id)).sort(d3.ascending));
    });
  }

  function drawLines() {
    const ratio = window.devicePixelRatio || 1;
    canvas.width = width * ratio; canvas.height = height * ratio;
    const ctx = canvas.getContext("2d");
    ctx.scale(ratio, ratio);
    const scoped = data.tracts.filter((t) => data.inScope(t, state.scope));
    const alpha = Math.max(0.04, Math.min(0.6, 30 / scoped.length));
    const line = (t) => {
      let started = false;
      ctx.beginPath();
      for (const id of state.axes) {
        const v = t.v[data.measureIndex.get(id)];
        if (v == null) { started = false; continue; }
        const px = x(id), py = ys.get(id)(v);
        if (started) ctx.lineTo(px, py); else { ctx.moveTo(px, py); started = true; }
      }
      ctx.stroke();
    };
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(150, 160, 155, 0.08)";
    scoped.filter((t) => !passesBrushes(data, t, state.brushes)).forEach(line);
    ctx.strokeStyle = `rgba(23, 74, 99, ${alpha})`;
    scoped.filter((t) => passesBrushes(data, t, state.brushes)).forEach(line);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = "rgba(194, 24, 91, 0.75)";
    (state.peers || []).map((id) => data.tractById.get(id)).filter(Boolean).forEach(line);
    if (state.hovered && data.tractById.get(state.hovered)) {
      ctx.lineWidth = 2; ctx.strokeStyle = "#17242b"; line(data.tractById.get(state.hovered));
    }
    if (state.selected && data.tractById.get(state.selected)) {
      ctx.lineWidth = 2.6; ctx.strokeStyle = "#c2185b"; line(data.tractById.get(state.selected));
    }
  }

  subscribe((changed) => {
    if (touches(changed, "axes")) { layout(); drawAxes(); }
    if (touches(changed, "axes", "scope", "brushes", "selected", "hovered", "peers")) drawLines();
  });
  layout(); drawAxes(); drawLines();
}

function short(name) {
  return name.length > 24 ? name.slice(0, 23) + "…" : name;
}
