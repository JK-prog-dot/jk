# Public Lists

A small static site to browse, search, filter and download public reference lists.

Current lists:

| List | Rows | Source | License |
|---|---|---|---|
| Pincodes (all India) | 20,144 | India Post directory, compiled in bilal-webdev/india-postal-pincode-dataset | MIT |
| Districts (all India) | 752 | Derived from the pincode list above | MIT |
| Bank codes (IFSC prefixes) | 1,346 | Razorpay `ifsc` package 2.0.50 (RBI and NPCI lists) | MIT |

Not available yet: village panchayats, town panchayats, municipalities, corporations. No public list for these could be reached while building this. The home page shows them as "not available yet".

## Use it

Open `site/index.html` in a browser, or serve the folder:

    cd site && python3 -m http.server 8000

Pages:
- `index.html`: categories, search across all lists (name or code).
- `list.html?id=<id>`: table with search, filters, column sort, paging, and downloads (full CSV, or the rows currently shown).

No build step or server-side code is needed, so it can be hosted on any static host (for example GitHub Pages).

## Add or refresh a list (import flow)

1. Drop the file into `sources/`. Supported: `.csv`, `.xlsx` (one dataset per sheet, needs `pip install openpyxl`), and `.sql` (SQLite-compatible; one dataset per table).
2. Add an entry to `sources/meta.json` under the dataset id (file name, or sheet or table name in lowercase). Set title, description, source, license, `code_column`, `name_column`, `search_columns`, and `filter_columns`.
3. Run:

       python3 scripts/import_lists.py

This writes `site/data/<id>.csv` and `site/data/catalog.json`. Headers are cleaned to lowercase with underscores. Output is UTF-8 with a BOM so Tamil text opens correctly in Excel.

To rebuild the three current lists from the raw downloads in `sources/raw/`, run `python3 scripts/prepare_sources.py` first, then the import.

## Notes

- Pincodes: one pincode can appear in several rows when it covers more than one block or district. That is how the source is structured.
- Data is a snapshot of the sources above, not a live feed. Check the source before relying on it for official use.
- Add a list only where its license allows redistribution. Keep the license in `meta.json`.
- Excluded on purpose: the electoral roll files (`AC_*.parquet`) in the `jk` repo contain personal details of individuals and are not part of this site.
