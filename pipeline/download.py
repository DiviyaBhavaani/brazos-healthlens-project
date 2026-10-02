"""
Step 1: download the raw source data for Texas into data/raw/.

    python pipeline/download.py

What it fetches
  places_tx.csv   CDC PLACES tract estimates, long format (one row per tract per measure)
  acs_tx.csv      Census ACS 5-year: population, median age, median income, % uninsured
  tl_<year>_48_tract.zip   Census TIGER/Line tract boundaries

SVI is optional and downloaded by hand (see the message printed at the end).
Set the CENSUS_API_KEY environment variable if you hit Census API rate limits.
"""
import io
import os

import pandas as pd
import requests

from config import ACS_YEAR, PLACES_DATASET_ID, RAW, STATE_ABBR, STATE_FIPS, TIGER_YEAR

RAW.mkdir(parents=True, exist_ok=True)


def download_places():
    """PLACES is served by Socrata (data.cdc.gov). We filter to Texas on the server
    and page through results, because one request returns at most $limit rows."""
    url = f"https://data.cdc.gov/resource/{PLACES_DATASET_ID}.csv"
    page_size, offset, frames = 50_000, 0, []
    while True:
        params = {
            "$where": f"stateabbr='{STATE_ABBR}'",
            "$limit": page_size,
            "$offset": offset,
            "$order": ":id",  # stable order so pages don't overlap
        }
        resp = requests.get(url, params=params, timeout=180)
        resp.raise_for_status()
        # dtype=str keeps leading zeros in FIPS codes
        page = pd.read_csv(io.StringIO(resp.text), dtype=str)
        frames.append(page)
        print(f"  PLACES rows {offset:,}-{offset + len(page):,}")
        if len(page) < page_size:
            break
        offset += page_size
    places = pd.concat(frames, ignore_index=True)
    places.to_csv(RAW / "places_tx.csv", index=False)
    print(f"Saved {len(places):,} PLACES rows -> data/raw/places_tx.csv")


def census_get(dataset, variables):
    """Call the Census API for every tract in Texas and return a DataFrame."""
    url = f"https://api.census.gov/data/{ACS_YEAR}/{dataset}"
    params = {"get": ",".join(variables), "for": "tract:*", "in": f"state:{STATE_FIPS}"}
    if os.environ.get("CENSUS_API_KEY"):
        params["key"] = os.environ["CENSUS_API_KEY"]
    resp = requests.get(url, params=params, timeout=120)
    resp.raise_for_status()
    rows = resp.json()
    df = pd.DataFrame(rows[1:], columns=rows[0])
    df["geoid"] = df["state"] + df["county"] + df["tract"]
    return df


def download_acs():
    detail = census_get("acs/acs5", ["B01003_001E", "B01002_001E", "B19013_001E"])
    detail = detail.rename(columns={
        "B01003_001E": "population",
        "B01002_001E": "median_age",
        "B19013_001E": "median_income",
    })
    # Subject table S2701: percent uninsured, all ages
    subject = census_get("acs/acs5/subject", ["S2701_C05_001E"])
    subject = subject.rename(columns={"S2701_C05_001E": "pct_uninsured"})
    acs = detail.merge(subject[["geoid", "pct_uninsured"]], on="geoid", how="left")
    acs = acs[["geoid", "population", "median_age", "median_income", "pct_uninsured"]]
    acs.to_csv(RAW / "acs_tx.csv", index=False)
    print(f"Saved {len(acs):,} ACS tracts -> data/raw/acs_tx.csv")


def download_tiger():
    name = f"tl_{TIGER_YEAR}_{STATE_FIPS}_tract.zip"
    url = f"https://www2.census.gov/geo/tiger/TIGER{TIGER_YEAR}/TRACT/{name}"
    resp = requests.get(url, timeout=300)
    resp.raise_for_status()
    (RAW / name).write_bytes(resp.content)
    print(f"Saved tract boundaries -> data/raw/{name}")


if __name__ == "__main__":
    download_places()
    download_acs()
    download_tiger()
    print(
        "\nOptional: CDC/ATSDR Social Vulnerability Index.\n"
        "  Go to the SVI data download page on atsdr.cdc.gov, choose year 2022, Texas,\n"
        "  census tracts, CSV, and save it as data/raw/svi_tx.csv.\n"
        "  The build step skips SVI if the file is missing."
    )
