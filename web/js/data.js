// Loads the pipeline output and adds derived fields the views need.
/* global d3, topojson */

export async function loadData() {
  const [db, topo] = await Promise.all([
    d3.json("data/healthlens.json"),
    d3.json("data/tracts.topo.json"),
  ]);

  const measureIndex = new Map(db.measures.map((m, i) => [m.id, i]));
  const tractById = new Map(db.tracts.map((t) => [t.id, t]));

  // Texas-wide mean and standard deviation per measure, used for z-scores.
  // z-scores put measures on one scale so "similar" means similar across all of them.
  const stats = db.measures.map((_, i) => {
    const vals = db.tracts.map((t) => t.v[i]).filter((v) => v != null);
    return { mean: d3.mean(vals), sd: d3.deviation(vals) || 1, extent: d3.extent(vals) };
  });

  // Relative CI width (interval width / value). The widest 10% per measure count as
  // "low confidence" when the user turns on the toggle.
  const ciCut = db.measures.map((_, i) => {
    const rel = db.tracts
      .filter((t) => t.v[i] > 0 && t.hi[i] != null)
      .map((t) => (t.hi[i] - t.lo[i]) / t.v[i]);
    return d3.quantile(rel.sort(d3.ascending), 0.9);
  });

  for (const t of db.tracts) {
    t.z = t.v.map((v, i) => (v == null ? null : (v - stats[i].mean) / stats[i].sd));
    t.countyName = db.counties[t.c] || t.c;
  }

  const features = topojson.feature(topo, topo.objects.tracts).features;
  for (const f of features) f.id = f.properties.id;

  const bv = new Set(db.brazosValley);
  const clusterLabel = (k) => {
    const c = db.clusters[k];
    const name = (id) => db.measures[measureIndex.get(id)]?.name ?? id;
    return `Group ${k + 1}: higher ${c.high.slice(0, 2).map(name).join(", ")}; lower ${c.low.slice(0, 2).map(name).join(", ")}`;
  };

  return {
    ...db,
    features,
    measureIndex,
    tractById,
    stats,
    ciCut,
    clusterLabel,
    inScope(t, scope) {
      if (scope === "TX") return true;
      if (scope === "BV") return bv.has(t.c);
      return t.c === scope;
    },
    // Accessor for any measure or context variable, so the scatterplot can mix both.
    value(t, id) {
      const i = measureIndex.get(id);
      return i === undefined ? t.x?.[id] ?? null : t.v[i];
    },
    label(id) {
      const i = measureIndex.get(id);
      return i === undefined ? db.context.find((c) => c.id === id)?.name ?? id : db.measures[i].name;
    },
    lowConfidence(t, id) {
      const i = measureIndex.get(id);
      if (i === undefined || t.v[i] == null || t.v[i] <= 0) return false;
      return (t.hi[i] - t.lo[i]) / t.v[i] > ciCut[i];
    },
  };
}

// Tracts in the current scope that also pass every parallel-coordinate brush.
export function passesBrushes(data, t, brushes) {
  for (const [id, [lo, hi]] of Object.entries(brushes)) {
    const v = t.v[data.measureIndex.get(id)];
    if (v == null || v < lo || v > hi) return false;
  }
  return true;
}

export const fmt = {
  pct: d3.format(".1f"),
  money: d3.format("$,.0f"),
  int: d3.format(","),
};

export function formatContext(id, v) {
  if (v == null) return "n/a";
  if (id === "median_income") return fmt.money(v);
  if (id === "svi") return d3.format(".2f")(v);
  return fmt.pct(v);
}

export function tractName(t) {
  // The last six digits of a tract GEOID are the tract number times 100 (020102 -> 201.02).
  return `Tract ${Number(t.id.slice(5)) / 100}, ${t.countyName} County`;
}
