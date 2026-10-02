"""
Generate SYNTHETIC raw data in the same formats as download.py.

    python pipeline/make_sample_data.py

Use it to develop the front end before (or without) downloading real data.
The numbers are invented: never present them as real health statistics.

How it works
  - Tracts are small grid squares clipped to a rough Texas outline.
  - Counties are groups of tracts around seed points; seven seeds sit at the
    real Brazos Valley county locations so the Brazos Valley scope works.
  - Each tract gets two hidden factors, "age" and "deprivation". Every measure
    is a weighted mix of them plus noise, so measures correlate the way
    real ones tend to, and clusters and peers have something to find.
  - Tracts near College Station get a young "age" factor to mimic student areas.
"""
import json

import numpy as np
import pandas as pd
from shapely.geometry import Point, Polygon, box, mapping

from config import BRAZOS_VALLEY, RAW

rng = np.random.default_rng(679)
RAW.mkdir(parents=True, exist_ok=True)

# Rough Texas outline (lon, lat). Good enough for a synthetic map.
TEXAS = Polygon([
    (-106.6, 31.9), (-103.06, 32.0), (-103.04, 36.5), (-100.0, 36.5), (-100.0, 34.56),
    (-97.9, 33.85), (-94.04, 33.55), (-94.04, 31.0), (-93.7, 29.75), (-94.7, 29.35),
    (-97.2, 27.6), (-97.15, 25.95), (-99.1, 26.45), (-100.3, 28.0), (-101.4, 29.75),
    (-103.1, 28.98), (-104.5, 29.6), (-106.6, 31.9),
])

# id, display name, PLACES category, (base, age weight, deprivation weight)
MEASURES = [
    ("DIABETES", "Diagnosed diabetes", "Health Outcomes", (11, 4, 4)),
    ("OBESITY", "Obesity", "Health Outcomes", (35, 2, 5)),
    ("CHD", "Coronary heart disease", "Health Outcomes", (6, 3, 1.5)),
    ("COPD", "COPD", "Health Outcomes", (6.5, 2.5, 2.5)),
    ("STROKE", "Stroke", "Health Outcomes", (3.4, 1.3, 1)),
    ("BPHIGH", "High blood pressure", "Health Outcomes", (32, 8, 4)),
    ("CASTHMA", "Current asthma", "Health Outcomes", (9.5, 0.3, 1.2)),
    ("DEPRESSION", "Depression", "Health Outcomes", (19, -1, 2)),
    ("CSMOKING", "Current smoking", "Health Risk Behaviors", (14, 0.5, 5)),
    ("LPA", "No leisure-time physical activity", "Health Risk Behaviors", (27, 3, 7)),
    ("SLEEP", "Short sleep duration", "Health Risk Behaviors", (35, -1, 4)),
    ("GHLTH", "Fair or poor health", "Health Status", (19, 3, 7)),
    ("MHLTH", "Frequent mental distress", "Health Status", (15, -2, 3)),
    ("PHLTH", "Frequent physical distress", "Health Status", (11, 2.5, 3)),
    ("ACCESS2", "Lack of health insurance (18-64)", "Prevention", (22, -2, 10)),
    ("CHECKUP", "Routine checkup in past year", "Prevention", (74, 6, -3)),
]

# Approximate real centroids of Brazos Valley counties
BV_SEEDS = {
    "48041": (-96.30, 30.66), "48051": (-96.62, 30.49), "48185": (-95.98, 30.54),
    "48289": (-95.99, 31.30), "48313": (-95.93, 30.97), "48395": (-96.51, 31.03),
    "48477": (-96.40, 30.21),
}
COLLEGE_STATION = Point(-96.33, 30.61)


def make_tracts(cell=0.12):
    xs = np.arange(-106.6, -93.5, cell)
    ys = np.arange(25.9, 36.5, cell)
    cells = []
    for x in xs:
        for y in ys:
            sq = box(x, y, x + cell, y + cell)
            if TEXAS.intersects(sq):
                clipped = sq.intersection(TEXAS)
                if clipped.geom_type == "Polygon" and clipped.area > cell * cell * 0.2:
                    cells.append(clipped)
    return cells


def assign_counties(cells):
    other_fips = [f"48{n:03d}" for n in range(1, 508, 2) if f"48{n:03d}" not in BV_SEEDS]
    seeds = dict(BV_SEEDS)
    for fips in other_fips[:240]:
        while True:
            p = (rng.uniform(-106.5, -93.6), rng.uniform(26, 36.4))
            # keep generic seeds away from the Brazos Valley so its counties stay intact
            if TEXAS.contains(Point(p)) and Point(p).distance(Point(-96.3, 30.7)) > 0.7:
                break
        seeds[fips] = p
    fips_list = list(seeds)
    pts = np.array([seeds[f] for f in fips_list])
    out = []
    for c in cells:
        cx, cy = c.centroid.x, c.centroid.y
        out.append(fips_list[int(np.argmin(((pts - [cx, cy]) ** 2).sum(1)))])
    names = {f: BRAZOS_VALLEY.get(f, f"Synthetic {f[2:]}") for f in fips_list}
    return out, names


def main():
    cells = make_tracts()
    county_of, county_names = assign_counties(cells)
    n = len(cells)
    print(f"{n:,} synthetic tracts in {len(set(county_of))} counties")

    # county-level effects make neighbors resemble each other
    county_dep = {f: rng.normal(0, 0.6) for f in county_names}
    county_age = {f: rng.normal(0, 0.5) for f in county_names}
    deprivation = np.array([county_dep[f] for f in county_of]) + rng.normal(0, 0.7, n)
    age = np.array([county_age[f] for f in county_of]) + rng.normal(0, 0.7, n)
    # student-heavy tracts around College Station
    for i, c in enumerate(cells):
        if c.centroid.distance(COLLEGE_STATION) < 0.2:
            age[i] = -2.2 + rng.normal(0, 0.3)
    population = rng.integers(1500, 9000, n)

    geoids = []
    counters = {}
    for f in county_of:
        counters[f] = counters.get(f, 0) + 1
        geoids.append(f"{f}{counters[f] * 100:06d}")

    rows = []
    for mid, name, cat, (base, wa, wd) in MEASURES:
        val = base + wa * age + wd * deprivation + rng.normal(0, base * 0.06, n)
        val = np.clip(val, 0.5, 95)
        half = (0.6 + 6 / np.sqrt(population / 100)) * (base / 15) + 0.3
        for i in range(n):
            rows.append({
                "year": "2023", "stateabbr": "TX", "statedesc": "Texas",
                "countyname": county_names[county_of[i]], "countyfips": county_of[i],
                "locationname": geoids[i], "datasource": "SYNTHETIC",
                "category": cat, "measure": name, "data_value_unit": "%",
                "data_value_type": "Crude prevalence", "datavaluetypeid": "CrdPrv",
                "data_value": round(val[i], 1),
                "low_confidence_limit": round(max(val[i] - half[i], 0), 1),
                "high_confidence_limit": round(val[i] + half[i], 1),
                "totalpopulation": int(population[i]),
                "measureid": mid, "short_question_text": name,
            })
    pd.DataFrame(rows).to_csv(RAW / "places_tx.csv", index=False)

    median_age = np.clip(38 + 7 * age + rng.normal(0, 2, n), 19, 70)
    acs = pd.DataFrame({
        "geoid": geoids,
        "population": population,
        "median_age": median_age.round(1),
        "median_income": np.clip(68000 - 18000 * deprivation + rng.normal(0, 6000, n), 15000, 220000).round(-2),
        "pct_uninsured": np.clip(17 + 7 * deprivation + rng.normal(0, 2, n), 2, 55).round(1),
    })
    acs.to_csv(RAW / "acs_tx.csv", index=False)

    svi = pd.DataFrame({
        "FIPS": geoids,
        "RPL_THEMES": pd.Series(deprivation + rng.normal(0, 0.4, n)).rank(pct=True).round(4),
    })
    svi.to_csv(RAW / "svi_tx.csv", index=False)

    features = [
        {"type": "Feature", "properties": {"GEOID": g}, "geometry": mapping(c)}
        for g, c in zip(geoids, cells)
    ]
    (RAW / "tracts_tx.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": features}))
    print("Wrote synthetic places_tx.csv, acs_tx.csv, svi_tx.csv, tracts_tx.geojson to data/raw/")


if __name__ == "__main__":
    main()
