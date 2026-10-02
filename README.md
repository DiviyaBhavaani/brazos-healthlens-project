# Brazos HealthLens

An interactive D3.js tool for exploring chronic disease estimates across Texas census
tracts, with the Brazos Valley as a case study. CSCE 679 Data Visualization project.

The repo ships with **synthetic demo data** so the site runs immediately. Replace it with
real CDC PLACES data before your evaluation or demo (step 2 below).

## 1. Run the site locally

```bash
cd web
python -m http.server 8000
```

Open http://localhost:8000. Opening `index.html` directly as a file does not work,
because browsers block `fetch` from `file://` pages.

## 2. Build the real data

```bash
python -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r pipeline/requirements.txt

python pipeline/download.py          # PLACES, ACS and tract boundaries for Texas (~5 minutes)
python pipeline/build.py             # writes web/data/healthlens.json and tracts.topo.json
```

Optional: download the CDC/ATSDR Social Vulnerability Index for Texas tracts by hand and save
it as `data/raw/svi_tx.csv` before running `build.py`.

To regenerate the synthetic data instead: `python pipeline/make_sample_data.py` then `python pipeline/build.py`.

## 3. Deploy to GitHub Pages

1. Create a GitHub repo and push this folder to the `main` branch.
2. In the repo, open **Settings > Pages** and set **Source** to **GitHub Actions**.
3. Every push to `main` now publishes `web/` automatically. The URL appears in the
   **Actions** tab and on the Pages settings screen, usually `https://<user>.github.io/<repo>/`.

After rebuilding data, commit the updated files in `web/data/` and push.

See **GUIDE.md** for how everything works and how to extend it.

## Layout

```
pipeline/            Python data pipeline
  config.py          settings (dataset ids, years, Brazos Valley counties, defaults)
  download.py        step 1: fetch raw data
  build.py           step 2: clean, join, cluster, export JSON
  make_sample_data.py  synthetic data in the same raw formats
web/                 static site deployed to GitHub Pages
  index.html
  css/style.css
  js/                one ES module per view, plus a shared store
  data/              built JSON loaded by the site
.github/workflows/deploy.yml   GitHub Pages deployment
```
