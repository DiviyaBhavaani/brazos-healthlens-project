// Peer finder and outliers (requirements R5, R6).
// Similarity = Euclidean distance between z-scores over the measures currently on
// the parallel coordinates, so users decide what "similar" means.
// With no tract selected, the panel lists the most unusual tracts in scope instead.
/* global d3 */
import { state, set, subscribe, touches } from "./store.js";
import { tractName } from "./data.js";

const N_PEERS = 10;

export function initPeers(data, el) {
  const root = d3.select(el);

  function computePeers() {
    const t = state.selected && data.tractById.get(state.selected);
    if (!t) return [];
    const idx = state.axes.map((id) => data.measureIndex.get(id));
    const out = [];
    for (const o of data.tracts) {
      if (o.id === t.id) continue;
      let sum = 0, ok = true;
      for (const i of idx) {
        if (t.z[i] == null || o.z[i] == null) { ok = false; break; }
        sum += (t.z[i] - o.z[i]) ** 2;
      }
      if (ok) out.push({ o, d: Math.sqrt(sum / idx.length) });
    }
    return out.sort((a, b) => a.d - b.d).slice(0, N_PEERS);
  }

  function render() {
    root.selectAll("*").remove();
    const t = state.selected && data.tractById.get(state.selected);
    if (t) {
      const peers = computePeers();
      if (peers.map((p) => p.o.id).join() !== (state.peers || []).join()) {
        queueMicrotask(() => set({ peers: peers.map((p) => p.o.id) }));
      }
      root.append("p").attr("class", "muted small")
        .text(`Most similar tracts anywhere in Texas, using the ${state.axes.length} measures on the parallel coordinates. Distance is the average gap in standard deviations.`);
      const ol = root.append("ol").attr("class", "peer-list");
      for (const { o, d } of peers) {
        // The measure where the peer differs most from the selected tract
        let worst = null;
        for (const id of state.axes) {
          const i = data.measureIndex.get(id);
          const gap = o.z[i] - t.z[i];
          if (!worst || Math.abs(gap) > Math.abs(worst.gap)) worst = { id, gap };
        }
        const li = ol.append("li").append("button").attr("type", "button")
          .on("click", () => set({ selected: o.id }))
          .on("pointerenter", () => set({ hovered: o.id }))
          .on("pointerleave", () => set({ hovered: null }));
        li.append("span").attr("class", "peer-name").text(tractName(o));
        li.append("span").attr("class", "peer-meta").text(
          `distance ${d.toFixed(2)}; biggest gap: ${data.label(worst.id)} ${worst.gap > 0 ? "higher" : "lower"} by ${Math.abs(worst.gap).toFixed(1)} SD`);
      }
      return;
    }
    if ((state.peers || []).length) queueMicrotask(() => set({ peers: [] }));
    const scoped = data.tracts.filter((x) => data.inScope(x, state.scope)).sort((a, b) => b.o - a.o).slice(0, 8);
    root.append("p").attr("class", "muted small")
      .text("No tract selected. These tracts in scope are furthest from their health profile group, so they may be worth a closer look.");
    const ol = root.append("ol").attr("class", "peer-list");
    for (const x of scoped) {
      const b = ol.append("li").append("button").attr("type", "button")
        .on("click", () => set({ selected: x.id }))
        .on("pointerenter", () => set({ hovered: x.id }))
        .on("pointerleave", () => set({ hovered: null }));
      b.append("span").attr("class", "peer-name").text(tractName(x));
      b.append("span").attr("class", "peer-meta").text(`more unusual than ${Math.min(99, Math.floor(x.o * 100))}% of Texas tracts; ${data.clusterLabel(x.k).split(":")[0]}`);
    }
  }

  subscribe((changed) => { if (touches(changed, "selected", "axes", "scope")) render(); });
  render();
}
