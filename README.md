# SCALAC HPC Observatory

Interactive 3D globe and dashboards of the HPC systems reported by SCALAC member centers
(2025 usage indicators). Static site — no build step, no server-side code.

## Run locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

Opening `index.html` directly also works (data is loaded from `assets/js/data.js`).

## Update the data

1. Replace `IndicadoresDeUsoHPCLAC2025.csv` with the new version (same columns).
2. If a new institution appears, add its coordinates to `data/institutions.json`
   (key = exact value of the *Institution* column).
3. Run `python3 scripts/build_data.py` — it regenerates `data/machines.json` and `assets/js/data.js`.

## Publish

Any static host works (GitHub Pages, the SCALAC web server, etc.). Upload the whole folder.

## Embed in the SCALAC main page

```html
<iframe src="https://YOUR-HOST/observatory/?embed=1"
        style="width:100%;height:1400px;border:0" loading="lazy"
        title="SCALAC HPC Observatory"></iframe>
```

`?embed=1` hides the site header/footer so the observatory blends into the host page.
`?machine=<name>` opens the page with a machine selected (e.g. `?machine=SDumont2nd`).

## Structure

```
index.html                 page
assets/css/style.css       SCALAC look (navy #090573, blue #0345bf, gold #e6b25c, Figtree)
assets/js/app.js           globe (globe.gl), filters, charts, tables
assets/js/data.js          generated data
data/machines.json         generated data (downloadable)
data/institutions.json     institution → city / lat / lon
scripts/build_data.py      CSV → JSON converter
```
