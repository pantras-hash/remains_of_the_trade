#!/usr/bin/env python3
"""Validate the CSV and metadata used by the GitHub Pages site.

Run from the repository root:
    python scripts/check_data.py
"""
from __future__ import annotations

import csv
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
DATA = DOCS / "data" / "measures_panel.csv"
META = DOCS / "data" / "index_metadata.json"
NAMES = DOCS / "data" / "country_names.json"

MISSING = {"", "NA", "NaN", "nan", "N/A", "."}


def main() -> int:
    problems: list[str] = []
    if not DATA.exists():
        print(f"Missing {DATA}")
        return 1
    with DATA.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
        columns = reader.fieldnames or []
    if "iso3" not in columns:
        problems.append("CSV must contain an iso3 column.")
    index_columns = [c for c in columns if c != "iso3"]
    seen: set[str] = set()
    for i, row in enumerate(rows, start=2):
        iso = (row.get("iso3") or "").strip().upper()
        if len(iso) != 3:
            problems.append(f"Row {i}: iso3 should be a 3-letter code, got {iso!r}.")
        if iso in seen:
            problems.append(f"Row {i}: duplicate iso3 code {iso}.")
        seen.add(iso)
        for col in index_columns:
            value = (row.get(col) or "").strip()
            if value in MISSING:
                continue
            try:
                number = float(value)
                if not math.isfinite(number):
                    raise ValueError
            except ValueError:
                problems.append(f"Row {i}, column {col}: non-numeric value {value!r}.")
    meta_ids: set[str] = set()
    if META.exists():
        meta = json.loads(META.read_text(encoding="utf-8"))
        meta_ids = {item.get("id", "") for item in meta.get("indices", [])}
    name_ids: set[str] = set()
    if NAMES.exists():
        name_ids = set(json.loads(NAMES.read_text(encoding="utf-8")).keys())
    missing_meta = [c for c in index_columns if c not in meta_ids]
    stale_meta = sorted(meta_ids.difference(index_columns))
    missing_names = sorted(seen.difference(name_ids))
    print(f"Rows: {len(rows)}")
    print(f"Index columns: {len(index_columns)}")
    if missing_meta:
        print("Columns without metadata:", ", ".join(missing_meta))
    if stale_meta:
        print("Metadata entries not present in CSV:", ", ".join(stale_meta))
    if missing_names:
        print("Country codes without display names:", ", ".join(missing_names))
    if problems:
        print("\nProblems:")
        for p in problems[:100]:
            print("-", p)
        if len(problems) > 100:
            print(f"... and {len(problems)-100} more")
        return 1
    print("Validation passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
