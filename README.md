# The Remains of Trade - GitHub Pages data explorer

This repository is a static website for the country-level exposure indices developed in the paper:

**The Remains of Trade: The U.S.-China Trade War and its Aftermath**  
Pol Antràs, Adrian Kulesza, and Andrea F. Presbitero

The site is designed for GitHub Pages. It does not require a server or a build system. The interactive maps and charts are generated in the browser from one CSV file.

## What is included

```text
docs/
  index.html                        Website page
  site_config.json                  Site title, paper/data links, version note
  assets/styles.css                 Visual styling
  assets/app.js                     Interactive map, rankings, scatter plot, product explorer, CSV parsing
  assets/favicon.svg                Small site icon
  data/measures_panel.csv           Current country-level index values
  data/index_metadata.json          Labels, families, and descriptions for each index
  data/country_names.json           ISO3-to-country-name lookup table
  data/top_products_wide.csv        Source data: top-ranked products per country per index (not fetched by the site directly)
  data/price_shocks_export.csv      Source data: per-commodity price shock estimates (not fetched by the site directly)
  data/hs6_descriptions.csv         Source data: HS6 product code -> description lookup (not fetched by the site directly)
  data/top_products_by_country.json Generated: top 10 products per country, per index (used by the country panel)
  data/products_index.json          Generated: list of selectable product codes for the Product Explorer
  data/products/<code>.json         Generated: one small file per product listing its most affected countries
  data/hs_labels.json               Generated: product code -> description lookup, filtered to codes used on the site
  data/price_shocks_table.json      Generated: one row per commodity with a price-shock estimate, for the price-shock reference table
  paper/resettling_trade.pdf        Paper PDF linked from the site
scripts/
  check_data.py                     Simple CSV and metadata validator
  build_products.py                 Builds the product-explorer JSON files from top_products_wide.csv, price_shocks_export.csv, and hs6_descriptions.csv
README.md                           This file
```

## Local preview

Do not double-click `docs/index.html`, because browsers often block local `fetch()` calls from ordinary files. Instead, run a tiny local server from the repository root:

```bash
python -m http.server 8000 --directory docs
```

Then open this address in a browser:

```text
http://localhost:8000
```

The map and scatter plot use Plotly from a CDN, so the browser needs internet access. The rest of the page and the data files are local.

## Create the GitHub website

### Option A: using GitHub's web interface

1. Go to GitHub and create a new repository under `pantras-hash`, for example `resettling-trade`.
2. Unzip this package on your computer.
3. Upload the contents of the unzipped folder to the new repository. Make sure the repository contains the `docs` folder, the `scripts` folder, and this `README.md` at the top level.
4. In the repository, go to **Settings** -> **Pages**.
5. Under **Build and deployment**, choose **Deploy from a branch**.
6. Select branch **main** and folder **/docs**.
7. Click **Save**.
8. After GitHub finishes publishing, the site should be available at something like:

```text
https://pantras-hash.github.io/resettling-trade/
```

### Option B: using Git on your computer

After creating the empty repository on GitHub, run the following from the unzipped folder:

```bash
git init
git add .
git commit -m "Initial data explorer"
git branch -M main
git remote add origin https://github.com/pantras-hash/resettling-trade.git
git push -u origin main
```

Then enable GitHub Pages from **Settings** -> **Pages** -> **Deploy from a branch** -> **main** -> **/docs**.

## Updating the data later

The site reads the CSV directly every time the page loads. No Python build step is needed.

1. Replace this file with your updated data:

```text
docs/data/measures_panel.csv
```

2. Keep the country-code column named exactly:

```text
iso3
```

3. Any other numeric column will automatically appear in the index dropdown.
4. If you add, drop, or rename columns, edit:

```text
docs/data/index_metadata.json
```

This file controls the nice labels, grouping, and descriptions. If a new column has no metadata entry, the website will still work, but it will show the raw column name and put the variable under `Other`.

5. Validate the updated data locally:

```bash
python scripts/check_data.py
```

6. Commit and push the changes:

```bash
git add docs/data/measures_panel.csv docs/data/index_metadata.json docs/data/country_names.json
git commit -m "Update exposure indices"
git push
```

GitHub Pages will update automatically, usually within a minute or two.

## Updating the product-level data

Unlike `measures_panel.csv`, the Product Explorer and country top-products
table are not read directly from their source CSVs at page load. Instead, a
build script pre-computes small JSON files ahead of time, because
`top_products_wide.csv` is far too large (tens of MB) to fetch in the
browser.

1. Replace the source files as needed:

```text
docs/data/top_products_wide.csv     top-ranked products per country, per index
docs/data/price_shocks_export.csv   per-commodity price-shock estimates
docs/data/hs6_descriptions.csv      HS6 code -> description lookup
```

2. Regenerate the derived JSON files:

```bash
python scripts/build_products.py
```

This only keeps commodities that have a non-missing `price_shock` in
`price_shocks_export.csv`, and writes:

```text
docs/data/top_products_by_country.json
docs/data/products_index.json
docs/data/hs_labels.json
docs/data/price_shocks_table.json
docs/data/products/<code>.json
```

3. Commit and push the source CSVs and the regenerated JSON/products files.

## Updating the paper

Replace the PDF while keeping the same filename:

```text
docs/paper/resettling_trade.pdf
```

If you want to use a different filename, also edit `docs/site_config.json` and change the `paper_url` field.

## Editing visible website text

For light edits, use these files:

- `docs/site_config.json`: title, subtitle, authors, paper version, paper link, data link, and work-in-progress note.
- `docs/data/index_metadata.json`: index labels, families, and descriptions.
- `docs/index.html`: methodology cards, download cards, and page structure.
- `docs/assets/styles.css`: colors, spacing, typography, and layout.

## Rank convention

For each selected index:

- Rank 1 is the highest observed value.
- Countries with missing values are excluded from the ranking for that index.
- The website displays values as the raw CSV value multiplied by 100, matching the scale used in the draft tables.

## Notes and limitations

- Country mapping is based on ISO3 codes. If you add a new non-standard code, add it to `docs/data/country_names.json`.
- Plotly's built-in choropleth recognizes most ISO3 codes, but some territories or special entities may not appear on the map even though they remain available in tables and downloads.
- The site is fully static. It is easy to host on GitHub Pages, but it does not support user accounts, server-side search, or private data.
