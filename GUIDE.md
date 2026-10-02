# How Brazos HealthLens works

This guide walks through the whole system: where the data comes from, what the pipeline
does to it, how the browser views talk to each other, and how deployment works. Read it
alongside the code; every file also has comments at the top explaining its job.

## 1. The big picture

```
 CDC PLACES  ─┐
 Census ACS  ─┼─ download.py ─▶ data/raw/ ─▶ build.py ─▶ web/data/*.json ─▶ browser
 TIGER tracts ┘                  (CSV, zip)   (pandas,     (2 static files)    (D3 views)
 SVI (manual) ┘                               sklearn)
```

The heavy work (joining datasets, clustering) happens once, in Python, on your laptop.
The website is completely static: two JSON files plus HTML, CSS and JavaScript. That
means no server to run, nothing to pay for, and GitHub Pages can host it for free.

## 2. The data pipeline

### Step 1: `download.py`

**PLACES.** data.cdc.gov runs Socrata, which exposes every dataset as a queryable API.
The script asks for rows where `stateabbr='TX'`, 50,000 rows at a time, until a page comes
back short. Texas has about 6,900 tracts × 40 measures, so expect roughly 275,000 rows.
`$order=:id` keeps pages stable so no row is fetched twice. Everything is read as text
(`dtype=str`) so FIPS codes like `048041` keep their leading zeros.

**ACS.** The Census API returns JSON arrays: the first row holds the column names. We ask
for every tract in state 48 and build the 11-digit tract id (GEOID) from the state,
county and tract columns. Variables: total population (B01003), median age (B01002),
median household income (B19013), and percent uninsured from subject table S2701.

**TIGER.** The tract boundary shapefile for Texas, as a zip. PLACES uses 2020-census
tracts, and the 2023 TIGER files use the same tract definitions, so ids line up.

### Step 2: `build.py`

1. **Load PLACES and keep crude prevalence.** Tract-level PLACES only publishes crude
   (not age-adjusted) prevalence, labeled `CrdPrv`.
2. **Pivot from long to wide.** The raw file has one row per tract per measure. We pivot
   three times to get tract × measure tables for the value, lower CI and upper CI.
3. **Drop sparse measures.** Any measure missing for more than 5% of tracts is removed
   (setting in `config.py`), so every view can assume nearly complete data.
4. **Join context.** ACS and SVI are joined on GEOID. Census and SVI use large negative
   numbers (like -666666666 or -999) for "no data", so negatives become missing.
5. **Standardize and cluster.** Each measure is converted to a z-score
   (value minus Texas mean, divided by standard deviation) so a 1-point change in stroke
   and a 1-point change in obesity don't count the same. K-means groups tracts with
   similar profiles. We try k = 4 to 8 and keep the k with the best silhouette score
   (how much closer each tract is to its own group than to the next nearest one).
   Groups are renumbered by overall burden so Group 1 is the lowest.
6. **Outlier score.** Each tract's distance from its group's centre, turned into a
   percentile. A tract at 0.98 is further from its group than 98% of Texas tracts are
   from theirs, meaning its combination of measures is unusual.
7. **Reference averages.** Texas, Brazos Valley and county averages are weighted by tract
   population. A simple average of tracts would count a 1,500-person tract the same as a
   9,000-person tract.
8. **Geometry.** Boundaries are converted to TopoJSON, which stores each shared border
   once instead of twice, and simplified. This shrinks the map file several times over.
   The script prints how many PLACES tracts found a boundary; if that drops below 95%,
   the tract vintages don't match.

### The JSON the site loads (`healthlens.json`)

| Field | What it holds |
| --- | --- |
| `meta` | Source, data year, build date, and whether the data is synthetic |
| `measures` | `{id, name, category}` for every measure, in display order |
| `context` | ACS and SVI variables available for each tract |
| `defaults` | Starting axes and map measure |
| `counties`, `brazosValley` | County names and the seven Brazos Valley FIPS codes |
| `clusters` | Each group's size and its three highest and lowest measures |
| `refs` | Population-weighted averages: `TX`, `BV`, and `counties[fips]` |
| `tracts` | One object per tract (below) |

Each tract: `id` (GEOID), `c` (county FIPS), `p` (population), `v`/`lo`/`hi` (value and
CI bounds, in the same order as `measures`), `x` (context variables), `k` (group),
`o` (outlier percentile). Short keys keep the file small.

### Synthetic data (`make_sample_data.py`)

Writes the same raw files as `download.py`, so `build.py` doesn't know the difference.
Each fake tract gets two hidden factors (age and deprivation); every measure mixes them
with noise, which produces realistic correlations for the scatterplot and clusters.
Tracts around College Station are made young on purpose to demonstrate requirement R8.
The site shows a banner whenever synthetic data is loaded.

## 3. The front end

### Why plain JavaScript modules

No React and no build step: `index.html` loads D3 and topojson-client from a CDN, then
`js/main.js` as an ES module. Anyone on the team can edit a file and refresh. The cost is
that we manage state ourselves, which takes about 30 lines.

### The shared store: how linking works (`store.js`)

All views read from one `state` object and change it only through `set()`. After every
change, each view's subscriber receives the list of changed keys and redraws only if a
key it cares about changed.

| Key | Set by | Used by |
| --- | --- | --- |
| `scope` | Area dropdown | Every view |
| `measure` | Map measure dropdown | Map, profile |
| `colorMode`, `hideLowConf` | Controls | Map |
| `selected` | Click on map, scatterplot or peer list | Map, profile, scatterplot, parallel coordinates, peers |
| `hovered` | Pointer over any view | Outlines and highlights everywhere |
| `axes` | Measures picker | Parallel coordinates, peer search |
| `brushes` | Dragging on a parallel-coordinates axis | Map, scatterplot, parallel coordinates, status line |
| `peers` | Peer panel after computing similarity | Map, scatterplot, parallel coordinates |
| `scatterX`, `scatterY` | Scatterplot dropdowns | Scatterplot |

Example: when you click a tract on the map, `map.js` calls `set({ selected: id })`.
The profile redraws for that tract, the peer panel computes the ten most similar tracts
and calls `set({ peers })`, and then the map, scatterplot and parallel coordinates all
outline those peers. No view knows the others exist.

### `data.js`

Loads both JSON files and adds what every view needs: lookups by id, Texas-wide mean,
standard deviation and range per measure, z-scores per tract, and the low-confidence
cutoff (the widest 10% of relative CI widths for each measure). It also provides
`inScope()`, `value()` for any measure or context variable, and `passesBrushes()`.

### The views

**Map (`map.js`, R1, R5, R7).** An SVG path per tract, projected with a conic equal-area
projection fitted to Texas so area isn't distorted. `d3.zoom` handles pan and zoom;
changing scope animates the zoom to that area's bounding box. Color modes: measure value
(yellow-green-blue ramp, domain from the 2nd to 98th percentile in scope so outliers
don't wash out contrast), CI width, group, or outlier score. Tracts outside the scope stay
pale for geographic context; tracts that fail a brush fade to 15% opacity. Selection,
peers and hover are drawn as outlines in a separate top layer.

**Profile (`profile.js`, R3, R7, R8).** For the selected tract: context first (median age,
income, uninsured, SVI), with a warning when median age is under 26. Then one row per
measure. Each row's axis spans the full Texas range, the dot is the tract, the line is its
95% confidence interval, and colored ticks mark the county, Brazos Valley and Texas
averages. If the CI overlaps the Texas tick, the difference may not be meaningful.

**Scatterplot (`scatter.js`, R4).** Points go on a `<canvas>` because thousands of SVG
circles get slow; axes and highlight rings stay in SVG on top. Hover and click use
`d3.Delaunay`, which finds the nearest point in logarithmic time. The Pearson correlation
of points passing the brushes appears below, with a reminder that correlation in modeled
estimates doesn't show cause. Context variables are available on either axis, so you can
plot a measure against median age.

**Parallel coordinates (`parcoords.js`, R2, R6).** One axis per chosen measure, one line
per tract, lines on canvas. Each axis has a `d3.brushY`; the brush range is stored in data
units (percent), not pixels, so it survives redraws. Axes span the full Texas range so a
brush means the same thing in every scope. Changing scope clears brushes.

**Peers and outliers (`peers.js`, R5, R6).** With a tract selected, it computes the
root-mean-square difference in z-scores against every Texas tract, over the measures on
the parallel coordinates, and lists the ten closest. Users change what "similar" means by
changing the axes. Each peer shows the measure where it differs most. With nothing
selected, the panel lists the in-scope tracts with the highest outlier scores.

**Controls (`controls.js`).** Every control only calls `set()`. The status line counts how
many tracts pass the brushes.

## 4. Requirements to code

| Requirement | Where it lives |
| --- | --- |
| R1 Geographic overview | `map.js`, Area dropdown |
| R2 Multivariate exploration | `parcoords.js`, measures picker |
| R3 Comparison | `profile.js` reference ticks |
| R4 Relationships | `scatter.js` |
| R5 Peer finding | `peers.js`, outlines in `map.js` |
| R6 Outliers | Outlier score map mode, `peers.js` empty state, parallel coordinates |
| R7 Uncertainty | CI lines in the profile, CI-width map mode, low-confidence hatching |
| R8 Context | Context block and young-population note in the profile, context variables in the scatterplot |

Update this table once your survey results reshape the requirements.

## 5. Deployment

`.github/workflows/deploy.yml` runs on every push to `main`: it checks out the repo,
uploads `web/` as a Pages artifact, and publishes it. Raw downloads are git-ignored; the
built JSON in `web/data/` is committed, because the site needs it and GitHub Pages
can't run Python. Workflow: rebuild data locally, commit `web/data/`, push.

GitHub occasionally releases new major versions of the Pages actions. If the workflow
warns about deprecated versions, bump the version numbers in `deploy.yml`.

## 6. Splitting the work

| Person (from the plan) | Files |
| --- | --- |
| Person 1: user research | Survey; updates GUIDE section 4 and requirements; runs evaluation |
| Person 2: data pipeline | `pipeline/`, `data.js` |
| Person 3: map and profile | `map.js`, `profile.js`, `controls.js` |
| Person 4: charts and linking | `scatter.js`, `parcoords.js`, `peers.js`, `store.js` |

Because views only communicate through the store, people can work on separate files with
few merge conflicts.

## 7. Ideas for extending

- **Stronger R8:** in the peer search, add an option to restrict peers to tracts with a
  similar median age, so student tracts compare only with other young tracts.
- **Axis reordering** in parallel coordinates by dragging axis labels.
- **Shareable links:** write `state` into the URL hash so a view can be bookmarked.
- **Cluster profiles:** a small-multiples chart of each group's average z-scores.
- **Canvas map:** if the real map feels slow when zooming, draw tracts on canvas instead
  of SVG and keep SVG only for outlines.

## 8. Troubleshooting

| Problem | Fix |
| --- | --- |
| "The data files could not be loaded" | Serve `web/` with `python -m http.server` instead of opening the file directly, and check that `web/data/` has both JSON files |
| Many tracts missing from the map | `build.py` warns about this. Check `TIGER_YEAR` uses 2020-census tracts and that the PLACES release matches |
| PLACES download times out | Re-run; or lower `page_size` in `download.py` |
| Census API error 429 or "invalid key" | Get a free key from the Census API site and set `CENSUS_API_KEY` |
| Map is slow | Raise `SIMPLIFY_TOLERANCE` in `config.py` and rebuild |
| A default measure is missing | The pipeline skips unknown ids; edit `DEFAULT_AXES` in `config.py` |

## 9. Caveats to state in your report

PLACES numbers are model-based estimates built from survey data and demographics, so some
patterns, including the clusters, partly reflect demographics. Present findings as
starting points for local investigation, show the confidence intervals, and never present
the synthetic demo data as real.
