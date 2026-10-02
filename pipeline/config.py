"""Shared settings for the data pipeline. Edit values here, not inside the scripts."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"          # downloaded source files (not committed to git)
OUT = ROOT / "web" / "data"          # JSON the website loads (committed to git)

STATE_FIPS = "48"
STATE_ABBR = "TX"

# CDC PLACES "Census Tract Data" (long format) on data.cdc.gov.
# The id has been reused across releases (it served the 2025 release as of late 2025).
# If CDC publishes a new release under a new id, update it here.
PLACES_DATASET_ID = "cwsq-ngmh"

# PLACES uses 2020-census tracts, so pair it with ACS and TIGER files on the same vintage.
ACS_YEAR = 2023
TIGER_YEAR = 2023

# Brazos Valley Council of Governments region: county FIPS -> name
BRAZOS_VALLEY = {
    "48041": "Brazos",
    "48051": "Burleson",
    "48185": "Grimes",
    "48289": "Leon",
    "48313": "Madison",
    "48395": "Robertson",
    "48477": "Washington",
}

# Measures shown first in parallel coordinates and used for peer search.
# Any id missing from the data is skipped automatically.
DEFAULT_AXES = ["DIABETES", "OBESITY", "LPA", "CSMOKING", "CHD", "COPD", "DEPRESSION", "ACCESS2"]
DEFAULT_COLOR = "DIABETES"

# Drop a measure if more than this share of Texas tracts lack a value.
MAX_MISSING_SHARE = 0.05

# Range of cluster counts to try; the best by silhouette score wins.
CLUSTER_K_RANGE = range(4, 9)

# Map geometry simplification (TopoJSON toposimplify tolerance, in degrees).
SIMPLIFY_TOLERANCE = 0.0004
