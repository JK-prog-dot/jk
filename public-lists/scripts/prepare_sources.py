#!/usr/bin/env python3
"""Turn the raw public downloads in sources/raw/ into CSV inputs in sources/.

Run:  python3 scripts/prepare_sources.py

Outputs:
  sources/pincodes.csv    copied from raw pincode dataset (MIT, bilal-webdev)
  sources/districts.csv   unique state + district + LGD codes, derived from pincodes
  sources/bank_codes.csv  bank IFSC codes from Razorpay ifsc package (MIT)
"""
import csv
import json
import shutil
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "sources" / "raw"
SRC = ROOT / "sources"


def pincodes():
    dst = SRC / "pincodes.csv"
    shutil.copyfile(RAW / "pincodes_india_post.csv", dst)
    with dst.open(encoding="utf-8") as f:
        return list(csv.DictReader(f))


def districts(rows):
    count = Counter()
    info = {}
    for r in rows:
        key = (r["state"], r["district"], r["state_lgd"], r["district_lgd"])
        count[key] += 1
        info[key] = True
    out = SRC / "districts.csv"
    with out.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["state", "district", "state_lgd", "district_lgd", "pincodes"])
        for key in sorted(count, key=lambda k: (k[0], k[1])):
            w.writerow([*key, count[key]])
    return len(count)


def bank_codes():
    banks = json.loads((RAW / "ifsc_banks.json").read_text(encoding="utf-8"))
    names = json.loads((RAW / "ifsc_bank_names.json").read_text(encoding="utf-8"))
    out = SRC / "bank_codes.csv"
    with out.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow([
            "ifsc_prefix", "bank_name", "internal_code", "sample_ifsc", "micr_sample",
            "iin", "bank_type", "upi", "ach_credit", "ach_debit", "nach_debit", "apbs",
        ])
        for code in sorted(banks):
            b = banks[code]
            ifsc = b.get("ifsc") or ""
            w.writerow([
                ifsc[:4], names.get(code, ""), code, ifsc, b.get("micr") or "",
                b.get("iin") or "", b.get("type") or "",
                "yes" if b.get("upi") else "no",
                "yes" if b.get("ach_credit") else "no",
                "yes" if b.get("ach_debit") else "no",
                "yes" if b.get("nach_debit") else "no",
                "yes" if b.get("apbs") else "no",
            ])
    return len(banks)


if __name__ == "__main__":
    rows = pincodes()
    print("pincodes:", len(rows))
    print("districts:", districts(rows))
    print("banks:", bank_codes())
