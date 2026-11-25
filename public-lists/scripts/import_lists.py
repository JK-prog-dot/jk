#!/usr/bin/env python3
"""Import list files from sources/ into site/data/ and write site/data/catalog.json.

Accepted inputs (top level of sources/ only):
  *.csv   one dataset per file (UTF-8, BOM ok)
  *.xlsx  one dataset per sheet (needs: pip install openpyxl)
  *.sql   SQLite-compatible dump; one dataset per table

Metadata (title, description, source, license, searchable and filter columns)
is read from sources/meta.json, keyed by dataset id. A dataset without an entry
still works, with defaults.

Run:  python3 scripts/import_lists.py
"""
import csv
import datetime as dt
import json
import re
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "sources"
OUT = ROOT / "site" / "data"


def slug(text):
    s = re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")
    return s or "dataset"


def clean(v):
    return "" if v is None else str(v).strip()


def read_csv(path):
    with path.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        headers = [h.strip() for h in next(reader)]
        rows = [r for r in reader if any(c.strip() for c in r)]
    return headers, rows


def read_xlsx(path):
    try:
        import openpyxl
    except ImportError:
        raise SystemExit("openpyxl is needed for .xlsx files: pip install openpyxl")
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    sheets = []
    for ws in wb.worksheets:
        data = [list(r) for r in ws.iter_rows(values_only=True)]
        data = [r for r in data if any(clean(c) for c in r)]
        if not data:
            continue
        headers = [clean(h) for h in data[0]]
        name = path.stem if len(wb.worksheets) == 1 else f"{path.stem}_{ws.title}"
        sheets.append((name, headers, data[1:]))
    return sheets


def read_sql(path):
    con = sqlite3.connect(":memory:")
    con.executescript(path.read_text(encoding="utf-8-sig"))
    tables = [r[0] for r in con.execute(
        "select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name")]
    sheets = []
    for t in tables:
        cur = con.execute(f'select * from "{t}"')
        headers = [d[0] for d in cur.description]
        sheets.append((t, headers, cur.fetchall()))
    con.close()
    return sheets


def load(path):
    suffix = path.suffix.lower()
    if suffix == ".csv":
        h, r = read_csv(path)
        return [(path.stem, h, r)]
    if suffix == ".xlsx":
        return read_xlsx(path)
    if suffix == ".sql":
        return read_sql(path)
    return []


def write_dataset(ds_id, headers, rows):
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{ds_id}.csv"
    # utf-8-sig so Excel opens Tamil text correctly
    with path.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(headers)
        for r in rows:
            w.writerow([clean(x) for x in r])
    return path


def main():
    meta_path = SRC / "meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
    datasets = []
    for path in sorted(SRC.iterdir()):
        if not path.is_file() or path.suffix.lower() not in (".csv", ".xlsx", ".sql"):
            continue
        for raw_id, headers, rows in load(path):
            ds_id = slug(raw_id)
            m = meta.get(ds_id, {})
            if m.get("hidden"):
                continue
            headers = [slug(h) if not m.get("keep_headers") else h for h in headers]
            write_dataset(ds_id, headers, rows)
            datasets.append({
                "id": ds_id,
                "title": m.get("title", ds_id.replace("_", " ").title()),
                "description": m.get("description", ""),
                "source": m.get("source", ""),
                "license": m.get("license", ""),
                "rows": len(rows),
                "columns": headers,
                "file": f"data/{ds_id}.csv",
                "code_column": m.get("code_column", headers[0] if headers else ""),
                "name_column": m.get("name_column", headers[1] if len(headers) > 1 else ""),
                "search_columns": m.get("search_columns", headers),
                "filter_columns": m.get("filter_columns", []),
                "group": m.get("group", "Lists"),
            })
            print(f"{ds_id}: {len(rows)} rows, {len(headers)} columns")

    catalog = {
        "generated": dt.date.today().isoformat(),
        "datasets": datasets,
        "upcoming": meta.get("_upcoming", []),
    }
    (OUT / "catalog.json").write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"catalog: {len(datasets)} datasets")


if __name__ == "__main__":
    main()
