#!/usr/bin/env python3
"""Build small product-level JSON files from the wide product CSV.

top_products_wide.csv is a ~40MB file with one row per (country, rank)
listing, for each of the four base indices (ECI, ICI, CGI, SGI), which
commodity ranks at that position for that country. It is too large to
ship to the browser as-is, so this script pre-computes the two views the
site actually needs:

  top_products_by_country.json   top 10 products per country, per index
                                  (one file, fetched once with the rest
                                  of the site's data)
  data/products/<commodity>.json countries most affected by that product,
                                  per index, sorted by contribution
                                  (descending). One small file per
                                  commodity so the Product Explorer only
                                  fetches the one it needs.
  data/products_index.json       list of selectable commodity codes
  data/hs_labels.json            commodity code -> short description,
                                  built from docs/data/hs6_descriptions.csv
  data/price_shocks_table.json   one row per commodity with a price_shock
                                  estimate, with the price-shock decomposition
                                  variables from price_shocks_export.csv and
                                  its HS label, sorted by price_shock
                                  (descending), for the Product Explorer's
                                  price-shock reference table

top_products_by_country.json includes a country's actual top-ranked
products, whether or not they have a price_shock estimate. The Product
Explorer outputs (data/products/, products_index.json,
price_shocks_table.json) only cover commodities with a non-missing
price_shock in docs/data/price_shocks_export.csv, since those features
are specifically about price-shock-driven effects.

Run from the repository root whenever docs/data/top_products_wide.csv
changes:

    python scripts/build_products.py
"""
from __future__ import annotations

import csv
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "docs" / "data"
SOURCE = DATA / "top_products_wide.csv"
PRICE_SHOCKS = DATA / "price_shocks_export.csv"
HS_DESCRIPTIONS = DATA / "hs6_descriptions.csv"
OUT_BY_COUNTRY = DATA / "top_products_by_country.json"
OUT_PRODUCTS_DIR = DATA / "products"
OUT_PRODUCTS_INDEX = DATA / "products_index.json"
OUT_HS_LABELS = DATA / "hs_labels.json"
OUT_PRICE_SHOCKS_TABLE = DATA / "price_shocks_table.json"

# Columns from price_shocks_export.csv shown in the price-shock table,
# matching the paper's Table C.1 (phi_cup, sigma_up, epsilon_cup, eta_cp,
# epsilon_bar_cp, tariff_delta, price_shock, price_shock_long). The CSV's
# other variants (price_shock_2nd, price_shock_short, price_shock_long_basic,
# tariff_delta_medium) are not shown, to keep the table matching the paper.
PRICE_SHOCK_COLUMNS = [
    "phi_cup", "sigma_up", "epsilon_cup", "eta_cp",
    "epsilon_bar_cp", "tariff_delta", "price_shock", "price_shock_long",
]

# The wide CSV only has commodity/share/contribution columns for these
# four base indices; variants (ECI_long, ISI, ESI, etc.) have no
# product-level breakdown in this file.
INDICES = ["ECI", "ICI", "CGI", "SGI"]
TOP_N_PER_COUNTRY = 10
MISSING = {"", "NA", "NaN", "nan", "N/A", "."}


def load_valid_commodities() -> set[str]:
    """Commodities with a non-missing price_shock estimate."""
    valid: set[str] = set()
    with PRICE_SHOCKS.open(newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            code = (row.get("commodity") or "").strip().strip('"')
            price_shock = (row.get("price_shock") or "").strip()
            if code and price_shock not in MISSING:
                valid.add(code)
    return valid


def load_hs_labels(codes: set[str]) -> dict[str, str]:
    """Map each commodity code to a description, using
    docs/data/hs6_descriptions.csv."""
    descriptions: dict[str, str] = {}
    with HS_DESCRIPTIONS.open(newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            code = (row.get("commodity") or "").strip()
            description = (row.get("hs_desc") or "").strip()
            if code:
                descriptions[code] = description

    return {code: descriptions[code] for code in codes if code in descriptions}


def build_price_shocks_table(labels: dict[str, str]) -> list[dict]:
    """One row per commodity with a price_shock estimate, sorted by
    price_shock (descending), for the price-shock reference table."""
    rows: list[dict] = []
    with PRICE_SHOCKS.open(newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            code = (row.get("commodity") or "").strip().strip('"')
            price_shock = to_number(row.get("price_shock"))
            if not code or price_shock is None:
                continue
            entry = {"commodity": code, "description": labels.get(code, "")}
            for col in PRICE_SHOCK_COLUMNS:
                entry[col] = to_number(row.get(col))
            rows.append(entry)
    rows.sort(key=lambda e: -e["price_shock"])
    return rows


def to_number(value: str):
    value = (value or "").strip()
    if value in MISSING:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def main() -> int:
    if not SOURCE.exists():
        print(f"Missing {SOURCE}")
        return 1
    if not PRICE_SHOCKS.exists():
        print(f"Missing {PRICE_SHOCKS}")
        return 1
    if not HS_DESCRIPTIONS.exists():
        print(f"Missing {HS_DESCRIPTIONS}")
        return 1

    valid_commodities = load_valid_commodities()
    print(f"Commodities with a price_shock estimate: {len(valid_commodities)}")

    by_country: dict[str, dict[str, list]] = {}
    by_commodity: dict[str, dict[str, list]] = {}

    with SOURCE.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            iso3 = (row.get("country_code") or "").strip().upper()
            if len(iso3) != 3:
                continue
            rank = to_number(row.get("rank"))
            if rank is None:
                continue
            for idx in INDICES:
                commodity = (row.get(f"{idx}_commodity") or "").strip()
                if not commodity or commodity in MISSING:
                    continue
                share = to_number(row.get(f"{idx}_share"))
                contribution = to_number(row.get(f"{idx}_contribution"))

                # The country panel shows a country's actual top-ranked
                # products, regardless of whether a price_shock estimate
                # exists for them.
                entry_country_side = {
                    "rank": int(rank),
                    "commodity": commodity,
                    "share": share,
                    "contribution": contribution,
                }
                country_bucket = by_country.setdefault(iso3, {}).setdefault(idx, [])
                country_bucket.append(entry_country_side)

                # The Product Explorer (picker, map, price-shock table)
                # only covers commodities with a price_shock estimate.
                if commodity not in valid_commodities:
                    continue
                entry_commodity_side = {
                    "iso3": iso3,
                    "rank": int(rank),
                    "share": share,
                    "contribution": contribution,
                }
                commodity_bucket = by_commodity.setdefault(commodity, {}).setdefault(idx, [])
                commodity_bucket.append(entry_commodity_side)

    for iso3, families in by_country.items():
        for idx, entries in families.items():
            entries.sort(key=lambda e: e["rank"])
            families[idx] = entries[:TOP_N_PER_COUNTRY]

    for commodity, families in by_commodity.items():
        for idx, entries in families.items():
            entries.sort(key=lambda e: (e["contribution"] is None, -(e["contribution"] or 0)))

    OUT_BY_COUNTRY.write_text(json.dumps(by_country, separators=(",", ":")), encoding="utf-8")

    if OUT_PRODUCTS_DIR.exists():
        shutil.rmtree(OUT_PRODUCTS_DIR)
    OUT_PRODUCTS_DIR.mkdir(parents=True)
    for commodity, families in by_commodity.items():
        (OUT_PRODUCTS_DIR / f"{commodity}.json").write_text(
            json.dumps(families, separators=(",", ":")), encoding="utf-8"
        )
    OUT_PRODUCTS_INDEX.write_text(
        json.dumps(sorted(by_commodity.keys()), separators=(",", ":")), encoding="utf-8"
    )

    country_side_commodities = {
        e["commodity"] for families in by_country.values() for entries in families.values() for e in entries
    }
    all_commodities = country_side_commodities | valid_commodities
    labels = load_hs_labels(all_commodities)
    OUT_HS_LABELS.write_text(json.dumps(labels, separators=(",", ":")), encoding="utf-8")

    price_shocks_table = build_price_shocks_table(labels)
    OUT_PRICE_SHOCKS_TABLE.write_text(json.dumps(price_shocks_table, separators=(",", ":")), encoding="utf-8")

    products_size_kb = sum(p.stat().st_size for p in OUT_PRODUCTS_DIR.glob("*.json")) / 1024
    print(f"Countries: {len(by_country)}")
    print(f"Distinct commodities (Product Explorer): {len(by_commodity)}")
    print(f"Distinct commodities (country panel): {len(country_side_commodities)}")
    print(f"Commodities with a description: {len(labels)} / {len(all_commodities)}")
    print(f"Price shock table rows: {len(price_shocks_table)}")
    print(f"Wrote {OUT_BY_COUNTRY.relative_to(ROOT)} ({OUT_BY_COUNTRY.stat().st_size / 1024:.0f} KB)")
    print(f"Wrote {OUT_PRODUCTS_INDEX.relative_to(ROOT)} ({OUT_PRODUCTS_INDEX.stat().st_size / 1024:.0f} KB)")
    print(f"Wrote {OUT_HS_LABELS.relative_to(ROOT)} ({OUT_HS_LABELS.stat().st_size / 1024:.0f} KB)")
    print(f"Wrote {OUT_PRICE_SHOCKS_TABLE.relative_to(ROOT)} ({OUT_PRICE_SHOCKS_TABLE.stat().st_size / 1024:.0f} KB)")
    print(f"Wrote {len(by_commodity)} files under {OUT_PRODUCTS_DIR.relative_to(ROOT)} ({products_size_kb:.0f} KB total)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
