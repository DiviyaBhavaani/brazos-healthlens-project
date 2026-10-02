// Profile panel for the selected tract (requirements R3, R7, R8).
// Each measure gets one row: the tract's value as a dot, its 95% confidence interval
// as a line, and tick marks for the county, Brazos Valley and Texas averages.
// Every row uses the full Texas range, so you can see where the tract sits statewide.
/* global d3 */
import { state, subscribe, touches } from "./store.js";
import { fmt, formatContext, tractName } from "./data.js";

export function initProfile(data, el) {
  const root = d3.select(el);

  function render() {
    root.selectAll("*").remove();
    const t = state.selected && data.tractById.get(state.selected);
    if (!t) {
      root.append("p").attr("class", "empty")
        .text("Select a tract on the map, scatterplot or peer list to see how it compares with its county, the Brazos Valley and Texas.");
      return;
    }
    root.append("h3").attr("class", "tract-name").text(tractName(t));
    root.append("p").attr("class", "muted small").text(`${t.p ? fmt.int(t.p) + " residents. " : ""}${data.clusterLabel(t.k)}.`);

    // Context first (R8): age structure changes how every number below should be read.
    const ctx = root.append("dl").attr("class", "context");
    for (const c of data.context) {
      ctx.append("dt").text(c.name);
      ctx.append("dd").text(formatContext(c.id, t.x[c.id]));
    }
    if (t.x.median_age != null && t.x.median_age < 26) {
      root.append("p").attr("class", "note")
        .text(`Young population (median age ${fmt.pct(t.x.median_age)}). Low chronic disease rates here may reflect age rather than better health.`);
    }

    const inBV = data.brazosValley.includes(t.c);
    const refs = [
      { key: "county", label: `${t.countyName} County`, vals: data.refs.counties[t.c] },
      ...(inBV ? [{ key: "bv", label: "Brazos Valley", vals: data.refs.BV }] : []),
      { key: "tx", label: "Texas", vals: data.refs.TX },
    ];
    const legend = root.append("p").attr("class", "ref-legend");
    legend.append("span").html('<span class="key dot"></span>This tract with 95% CI');
    refs.forEach((r) => legend.append("span").html(`<span class="key tick ${r.key}"></span>${r.label} average`));

    const W = 150, H = 18;
    const byCat = d3.group(data.measures.map((m, i) => ({ ...m, i })), (m) => m.category);
    for (const [cat, ms] of byCat) {
      root.append("h4").text(cat);
      const table = root.append("table").attr("class", "profile");
      for (const m of ms) {
        const tr = table.append("tr").attr("class", m.id === state.measure ? "current" : null);
        tr.append("th").attr("scope", "row").text(m.name);
        const v = t.v[m.i];
        tr.append("td").attr("class", "num").text(v == null ? "n/a" : `${fmt.pct(v)}%`);
        const x = d3.scaleLinear().domain(data.stats[m.i].extent).range([4, W - 4]);
        const s = tr.append("td").append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("width", W).attr("height", H);
        s.append("line").attr("class", "base").attr("x1", 4).attr("x2", W - 4).attr("y1", H / 2).attr("y2", H / 2);
        for (const r of refs) {
          const rv = r.vals?.[m.i];
          if (rv != null) s.append("line").attr("class", `tick ${r.key}`).attr("x1", x(rv)).attr("x2", x(rv)).attr("y1", 3).attr("y2", H - 3);
        }
        if (v != null) {
          if (t.lo[m.i] != null) s.append("line").attr("class", "ci").attr("x1", x(t.lo[m.i])).attr("x2", x(t.hi[m.i])).attr("y1", H / 2).attr("y2", H / 2);
          s.append("circle").attr("class", "dot").attr("cx", x(v)).attr("cy", H / 2).attr("r", 3.5);
        }
        const ci = t.lo[m.i] != null ? `, 95% CI ${fmt.pct(t.lo[m.i])} to ${fmt.pct(t.hi[m.i])}` : "";
        tr.attr("title", `${m.name}: ${v == null ? "n/a" : fmt.pct(v) + "%"}${ci}. Texas average ${fmt.pct(data.refs.TX[m.i])}%.`);
      }
    }
  }

  subscribe((changed) => { if (touches(changed, "selected", "measure")) render(); });
  render();
}
