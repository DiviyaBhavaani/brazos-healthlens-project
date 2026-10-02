"""
Step 2: turn raw files into the two files the website loads.

    python pipeline/build.py

Outputs (in web/data/)
  tracts.topo.json   simplified tract boundaries (TopoJSON)
  healthlens.json    measures, per-tract values with confidence intervals,
                     context variables, clusters, outlier scores, reference averages

Pipeline
  1. Load PLACES (long format) and keep crude prevalence for Texas tracts.
  2. Pivot to one row per tract: value, lower CI and upper CI for every measure.
  3. Drop measures with too many missing tracts.
  4. Join ACS context (age, income, uninsured) and SVI if present.
  5. Standardize measures (z-scores) and cluster tracts with k-means.
  6. Score outliers as distance from the tract's cluster centre.
  7. Compute population-weighted reference averages (Texas, Brazos Valley, counties).
  8. Simplify geometry, convert to TopoJSON, write both files.
"""
import json
import zipfile
from datetime import date

import geopandas as gpd
import numpy as np
import pandas as pd
import topojson
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score

from config import (BRAZOS_VALLEY, CLUSTER_K_RANGE, DEFAULT_AXES, DEFAULT_COLOR,
                    MAX_MISSING_SHARE, OUT, RAW, SIMPLIFY_TOLERANCE, STATE_FIPS, TIGER_YEAR)

OUT.mkdir(parents=True, exist_ok=True)
CATEGORY_ORDER = ["Health Outcomes", "Health Risk Behaviors", "Health Status",
                  "Disability", "Prevention", "Health-Related Social Needs"]


# ---------------------------------------------------------------- 1-3. PLACES
def load_places():
    df = pd.read_csv(RAW / "places_tx.csv", dtype=str)
    df.columns = [c.lower() for c in df.columns]
    if "datavaluetypeid" in df:
        df = df[df["datavaluetypeid"] == "CrdPrv"]  # tract level only has crude prevalence
    for col in ["data_value", "low_confidence_limit", "high_confidence_limit", "totalpopulation"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df["geoid"] = df["locationname"].str.zfill(11)
    df["countyfips"] = df["countyfips"].str.zfill(5)
    synthetic = df.get("datasource", pd.Series(dtype=str)).eq("SYNTHETIC").any()
    year = df["year"].dropna().max() if "year" in df else ""
    return df, bool(synthetic), year


def measure_table(df):
    name_col = "short_question_text" if "short_question_text" in df else "measure"
    meta = (df.groupby("measureid")
              .agg(name=(name_col, "first"), category=("category", "first"))
              .reset_index())
    meta["order"] = meta["category"].map({c: i for i, c in enumerate(CATEGORY_ORDER)}).fillna(99)
    return meta.sort_values(["order", "name"]).drop(columns="order")


def pivot(df, value_col):
    return df.pivot_table(index="geoid", columns="measureid", values=value_col, aggfunc="first")


# ---------------------------------------------------------------- 4. context
def load_context(geoids):
    ctx = pd.DataFrame(index=pd.Index(geoids, name="geoid"))
    acs_path = RAW / "acs_tx.csv"
    if acs_path.exists():
        acs = pd.read_csv(acs_path, dtype={"geoid": str}).set_index("geoid")
        for col in ["median_age", "median_income", "pct_uninsured", "population"]:
            if col in acs:
                vals = pd.to_numeric(acs[col], errors="coerce")
                vals[vals < 0] = np.nan  # Census uses large negative codes for "no data"
                ctx[col] = vals
        print(f"ACS joined for {ctx['median_age'].notna().sum():,} of {len(ctx):,} tracts")
    svi_path = RAW / "svi_tx.csv"
    if svi_path.exists():
        svi = pd.read_csv(svi_path, dtype={"FIPS": str})
        svi["FIPS"] = svi["FIPS"].str.zfill(11)
        vals = pd.to_numeric(svi.set_index("FIPS")["RPL_THEMES"], errors="coerce")
        vals[vals < 0] = np.nan  # SVI uses -999 for missing
        ctx["svi"] = vals
        print(f"SVI joined for {ctx['svi'].notna().sum():,} tracts")
    return ctx


# ---------------------------------------------------------------- 5-6. clusters
def cluster(values):
    z = (values - values.mean()) / values.std(ddof=0)
    z = z.fillna(0)  # a missing value counts as "average" for clustering only
    sample = z.sample(min(3000, len(z)), random_state=0)
    best_k, best_score = None, -1
    for k in CLUSTER_K_RANGE:
        labels = KMeans(n_clusters=k, n_init=10, random_state=0).fit_predict(sample)
        score = silhouette_score(sample, labels)
        print(f"  k={k}: silhouette {score:.3f}")
        if score > best_score:
            best_k, best_score = k, score
    model = KMeans(n_clusters=best_k, n_init=10, random_state=0).fit(z)
    labels = model.labels_
    dist = np.linalg.norm(z.values - model.cluster_centers_[labels], axis=1)
    outlier_pct = pd.Series(dist, index=z.index).rank(pct=True)
    print(f"Chose k={best_k} clusters")

    summaries = []
    for k in range(best_k):
        centre = pd.Series(model.cluster_centers_[k], index=z.columns)
        summaries.append({
            "id": k,
            "n": int((labels == k).sum()),
            "high": centre.sort_values(ascending=False).index[:3].tolist(),
            "low": centre.sort_values().index[:3].tolist(),
        })
    # number clusters by overall burden so cluster 1 is the lowest-burden group
    burden = [model.cluster_centers_[k].mean() for k in range(best_k)]
    order = np.argsort(burden)
    remap = {old: new for new, old in enumerate(order)}
    for s in summaries:
        s["id"] = remap[s["id"]]
    summaries.sort(key=lambda s: s["id"])
    return pd.Series([remap[l] for l in labels], index=z.index), outlier_pct, summaries


# ---------------------------------------------------------------- 7. references
def weighted_mean(frame, weights):
    w = weights.reindex(frame.index).fillna(0)
    out = {}
    for col in frame:
        ok = frame[col].notna() & (w > 0)
        out[col] = float(np.average(frame.loc[ok, col], weights=w[ok])) if ok.any() else None
    return out


# ---------------------------------------------------------------- 8. geometry
def load_geometry(geoids):
    synthetic = RAW / "tracts_tx.geojson"
    tiger = RAW / f"tl_{TIGER_YEAR}_{STATE_FIPS}_tract.zip"
    if tiger.exists():
        gdf = gpd.read_file(f"zip://{tiger}")
    elif synthetic.exists():
        gdf = gpd.read_file(synthetic)
    else:
        raise FileNotFoundError("No tract boundaries found in data/raw/. Run download.py first.")
    gdf = gdf.to_crs(4326)[["GEOID", "geometry"]]
    matched = gdf["GEOID"].isin(geoids)
    print(f"Boundaries matched {matched.sum():,} of {len(geoids):,} PLACES tracts")
    if matched.sum() < 0.95 * len(geoids):
        print("  WARNING: many tracts unmatched. Check that TIGER_YEAR uses 2020-census tracts.")
    gdf = gdf[matched].rename(columns={"GEOID": "id"})
    topo = topojson.Topology(gdf, object_name="tracts", prequantize=1e6,
                             toposimplify=SIMPLIFY_TOLERANCE)
    return json.loads(topo.to_json())


def rnd(x, digits=1):
    return None if x is None or pd.isna(x) else round(float(x), digits)


def main():
    places, synthetic, year = load_places()
    meta = measure_table(places)
    values, lows, highs = (pivot(places, c) for c in
                           ["data_value", "low_confidence_limit", "high_confidence_limit"])

    missing = values.isna().mean()
    keep = [m for m in meta["measureid"] if m in values and missing[m] <= MAX_MISSING_SHARE]
    dropped = sorted(set(meta["measureid"]) - set(keep))
    if dropped:
        print(f"Dropped measures with >{MAX_MISSING_SHARE:.0%} missing: {dropped}")
    meta = meta[meta["measureid"].isin(keep)]
    values, lows, highs = values[keep], lows[keep], highs[keep]

    tract_info = (places.groupby("geoid")
                        .agg(county=("countyfips", "first"), county_name=("countyname", "first"),
                             pop=("totalpopulation", "first")))
    tract_info = tract_info.loc[values.index]
    ctx = load_context(values.index)

    labels, outlier_pct, clusters = cluster(values)

    pop = tract_info["pop"]
    refs = {"TX": weighted_mean(values, pop)}
    bv = tract_info.index[tract_info["county"].isin(BRAZOS_VALLEY)]
    refs["BV"] = weighted_mean(values.loc[bv], pop)
    refs["counties"] = {
        fips: [rnd(v) for v in weighted_mean(values.loc[idx], pop).values()]
        for fips, idx in tract_info.groupby("county").groups.items()
    }
    refs["TX"] = [rnd(v) for v in refs["TX"].values()]
    refs["BV"] = [rnd(v) for v in refs["BV"].values()]

    context_vars = [
        {"id": "median_age", "name": "Median age (years)"},
        {"id": "median_income", "name": "Median household income ($)"},
        {"id": "pct_uninsured", "name": "Uninsured, all ages (%)"},
        {"id": "svi", "name": "Social vulnerability (percentile, 0-1)"},
    ]
    context_vars = [c for c in context_vars if c["id"] in ctx]

    tracts = []
    for gid in values.index:
        tracts.append({
            "id": gid,
            "c": tract_info.at[gid, "county"],
            "p": int(pop[gid]) if pd.notna(pop[gid]) else None,
            "v": [rnd(x) for x in values.loc[gid]],
            "lo": [rnd(x) for x in lows.loc[gid]],
            "hi": [rnd(x) for x in highs.loc[gid]],
            "x": {c["id"]: rnd(ctx.at[gid, c["id"]], 3 if c["id"] == "svi" else 1)
                  for c in context_vars},
            "k": int(labels[gid]),
            "o": rnd(outlier_pct[gid], 3),
        })

    counties = tract_info.groupby("county")["county_name"].first().to_dict()
    payload = {
        "meta": {
            "source": "SYNTHETIC demo data" if synthetic else "CDC PLACES census tract estimates",
            "year": year,
            "synthetic": synthetic,
            "built": date.today().isoformat(),
        },
        "measures": [{"id": r.measureid, "name": r.name, "category": r.category}
                     for r in meta.itertuples()],
        "context": context_vars,
        "defaults": {
            "axes": [m for m in DEFAULT_AXES if m in keep] or keep[:8],
            "color": DEFAULT_COLOR if DEFAULT_COLOR in keep else keep[0],
        },
        "counties": counties,
        "brazosValley": [f for f in BRAZOS_VALLEY if f in counties],
        "clusters": clusters,
        "refs": refs,
        "tracts": tracts,
    }
    (OUT / "healthlens.json").write_text(json.dumps(payload, separators=(",", ":")))
    (OUT / "tracts.topo.json").write_text(json.dumps(load_geometry(set(values.index)),
                                                     separators=(",", ":")))
    for f in ["healthlens.json", "tracts.topo.json"]:
        print(f"Wrote web/data/{f} ({(OUT / f).stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
