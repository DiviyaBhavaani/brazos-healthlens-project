// Entry point: load data, set initial state, start every view.
import { state, set } from "./store.js";
import { loadData } from "./data.js";
import { initControls } from "./controls.js";
import { initMap } from "./map.js";
import { initProfile } from "./profile.js";
import { initScatter } from "./scatter.js";
import { initParcoords } from "./parcoords.js";
import { initPeers } from "./peers.js";

async function start() {
  const status = document.getElementById("load-status");
  try {
    const data = await loadData();
    if (data.meta.synthetic) document.getElementById("synthetic-banner").hidden = false;
    document.getElementById("source").textContent =
      `${data.meta.source}${data.meta.year ? `, data year ${data.meta.year}` : ""}. Built ${data.meta.built}.`;

    // Initial state, set before views subscribe so they start in sync
    Object.assign(state, {
      measure: data.defaults.color,
      axes: data.defaults.axes,
      scatterX: data.measureIndex.has("LPA") ? "LPA" : data.defaults.axes[1],
      scatterY: data.defaults.color,
    });

    initControls(data, document.getElementById("controls"));
    initMap(data, document.getElementById("map"), document.getElementById("map-legend"));
    initProfile(data, document.getElementById("profile"));
    initScatter(data, document.getElementById("scatter"), document.getElementById("scatter-r"));
    initParcoords(data, document.getElementById("parcoords"));
    initPeers(data, document.getElementById("peers"));
    initScatterPickers(data);
    status.remove();

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") set({ selected: null });
    });
  } catch (err) {
    console.error(err);
    status.textContent = "The data files could not be loaded. Run the pipeline (see README) and serve the web folder over HTTP, not as a file.";
  }
}

function initScatterPickers(data) {
  const options = [
    ...data.measures.map((m) => [m.id, m.name]),
    ...data.context.map((c) => [c.id, c.name]),
  ];
  for (const [id, key] of [["scatter-x", "scatterX"], ["scatter-y", "scatterY"]]) {
    const sel = document.getElementById(id);
    sel.innerHTML = options.map(([v, n]) => `<option value="${v}">${n}</option>`).join("");
    sel.value = state[key];
    sel.addEventListener("change", () => set({ [key]: sel.value }));
  }
}

start();
