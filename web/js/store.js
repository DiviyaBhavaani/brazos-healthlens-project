// A tiny shared store. Every view reads state from here and calls set() to change it.
// When state changes, every subscriber is told which keys changed, so each view can
// redraw only what it needs. This is how brushing and linking works across views.

const listeners = new Set();

export const state = {
  scope: "BV",          // "TX", "BV" (Brazos Valley) or a county FIPS code
  measure: null,        // measure id used to color the map
  colorMode: "value",   // "value" | "uncertainty" | "cluster" | "outlier"
  hideLowConf: false,   // grey out tracts with very wide confidence intervals
  selected: null,       // selected tract id
  hovered: null,        // tract id under the pointer in any view
  axes: [],             // measures on the parallel coordinates; also used for peer search
  brushes: {},          // measure id -> [min, max] from parallel coordinate brushes
  scatterX: null,
  scatterY: null,
  peers: [],            // ids of the tracts most similar to the selected one
};

export function set(patch) {
  const changed = Object.keys(patch).filter((k) => state[k] !== patch[k]);
  if (!changed.length) return;
  Object.assign(state, patch);
  listeners.forEach((fn) => fn(changed));
}

export function subscribe(fn) {
  listeners.add(fn);
}

// True if any of the changed keys are ones this view cares about.
export const touches = (changed, ...keys) => changed.some((k) => keys.includes(k));
