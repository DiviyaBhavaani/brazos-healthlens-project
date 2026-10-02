// Left-hand controls. Each control only calls set(); the views react on their own.
/* global d3 */
import { state, set, subscribe, touches } from "./store.js";
import { passesBrushes, fmt } from "./data.js";

const MAX_AXES = 10, MIN_AXES = 3;

export function initControls(data, el) {
  const root = d3.select(el);

  // Scope: Texas, Brazos Valley, Brazos Valley counties, then every other county
  const scope = field(root, "Area", "scope-select").append("select").attr("id", "scope-select")
    .on("change", (e) => set({ scope: e.target.value, brushes: {} }));
  scope.append("option").attr("value", "TX").text("All of Texas");
  scope.append("option").attr("value", "BV").text("Brazos Valley (7 counties)");
  const bvGroup = scope.append("optgroup").attr("label", "Brazos Valley counties");
  data.brazosValley.forEach((f) => bvGroup.append("option").attr("value", f).text(`${data.counties[f]} County`));
  const otherGroup = scope.append("optgroup").attr("label", "Other Texas counties");
  Object.entries(data.counties).filter(([f]) => !data.brazosValley.includes(f))
    .sort((a, b) => a[1].localeCompare(b[1]))
    .forEach(([f, n]) => otherGroup.append("option").attr("value", f).text(`${n} County`));

  // Measure shown on the map and highlighted in the profile
  const measure = field(root, "Map measure", "measure-select").append("select").attr("id", "measure-select")
    .on("change", (e) => set({ measure: e.target.value }));
  for (const [cat, ms] of d3.group(data.measures, (m) => m.category)) {
    const g = measure.append("optgroup").attr("label", cat);
    ms.forEach((m) => g.append("option").attr("value", m.id).text(m.name));
  }

  // Map color mode
  const modes = [
    ["value", "Measure value"],
    ["uncertainty", "Confidence interval width"],
    ["cluster", "Health profile group"],
    ["outlier", "Outlier score"],
  ];
  const fs = root.append("fieldset");
  fs.append("legend").text("Color the map by");
  modes.forEach(([v, label]) => {
    const l = fs.append("label").attr("class", "radio");
    l.append("input").attr("type", "radio").attr("name", "colorMode").attr("value", v)
      .on("change", () => set({ colorMode: v }));
    l.append("span").text(label);
  });

  const lc = root.append("label").attr("class", "check");
  lc.append("input").attr("type", "checkbox").attr("id", "lowconf")
    .on("change", (e) => set({ hideLowConf: e.target.checked }));
  lc.append("span").text("Hatch low-confidence tracts");

  // Axes picker for parallel coordinates and peer search
  const det = root.append("details").attr("class", "axes-picker");
  const summary = det.append("summary");
  const list = det.append("div").attr("class", "axes-list");
  for (const [cat, ms] of d3.group(data.measures, (m) => m.category)) {
    list.append("p").attr("class", "group-label").text(cat);
    ms.forEach((m) => {
      const l = list.append("label").attr("class", "check");
      l.append("input").attr("type", "checkbox").attr("value", m.id).on("change", (e) => {
        let axes = state.axes.filter((a) => a !== m.id);
        if (e.target.checked) axes = [...state.axes, m.id];
        if (axes.length < MIN_AXES || axes.length > MAX_AXES) { e.target.checked = !e.target.checked; return; }
        const brushes = Object.fromEntries(Object.entries(state.brushes).filter(([k]) => axes.includes(k)));
        set({ axes, brushes });
      });
      l.append("span").text(m.name);
    });
  }

  const status = root.append("div").attr("class", "status");
  const statusText = status.append("p");
  const clear = status.append("button").attr("type", "button").text("Clear filters")
    .on("click", () => set({ brushes: {} }));

  function sync() {
    scope.property("value", state.scope);
    measure.property("value", state.measure);
    fs.selectAll("input").property("checked", function () { return this.value === state.colorMode; });
    root.select("#lowconf").property("checked", state.hideLowConf)
      .property("disabled", state.colorMode !== "value");
    summary.text(`Measures for comparison (${state.axes.length} of up to ${MAX_AXES})`);
    list.selectAll("input").property("checked", function () { return state.axes.includes(this.value); });
    const scoped = data.tracts.filter((t) => data.inScope(t, state.scope));
    const passing = scoped.filter((t) => passesBrushes(data, t, state.brushes)).length;
    const nFilters = Object.keys(state.brushes).length;
    statusText.text(nFilters
      ? `${fmt.int(passing)} of ${fmt.int(scoped.length)} tracts match ${nFilters} filter${nFilters > 1 ? "s" : ""}.`
      : `${fmt.int(scoped.length)} tracts in this area. Drag on a parallel-coordinates axis to filter.`);
    clear.property("disabled", !nFilters);
  }

  subscribe((changed) => {
    if (touches(changed, "scope", "measure", "colorMode", "hideLowConf", "axes", "brushes")) sync();
  });
  sync();
}

function field(root, label, id) {
  const f = root.append("div").attr("class", "field");
  f.append("label").attr("for", id).text(label);
  return f;
}
