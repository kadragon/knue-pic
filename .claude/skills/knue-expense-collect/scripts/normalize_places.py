#!/usr/bin/env python3
"""Stage 3 — collapse spelling variants and split food venues from the rest.

Usage:
    python3 normalize_places.py --month 2026-07 [--out-dir collector/out]
                                [--exclusions <path to assets/exclusions.json>]

Reads raw_transactions.json, writes normalized_places.json with two buckets:
  places   — candidates to geocode
  excluded — venues a rule in exclusions.json already rejected by name

Food-vs-not is NOT decided here. The name alone cannot tell 씨유한국교원대점 from
a restaurant, but the geocoder returns a category for every hit, so stage 4
classifies on that instead. exclusions.json only carries names worth skipping
before spending an API call on them.

Merging is deliberately conservative. Two spellings merge only when they
normalise to the same string; "본도시락" and "본도시락 오송점" stay apart, because
docs/architecture.md treats a branch as its own place and the data cannot prove
they are the same shop.
"""

from __future__ import annotations

import argparse
import json
import os
import re

# A single row naming two venues cannot be attributed to either one.
MULTI_VENUE = re.compile(r"외\s*\d+\s*곳|,|/| 및 ")

_CORP = re.compile(r"㈜|\(주\)|주식회사|\(유\)|㈐")


def canonical(name: str) -> str:
    """Collapse the spelling noise the disclosures actually contain."""
    text = _CORP.sub("", name)
    text = text.replace("까페", "카페")
    text = re.sub(r"[\s·ㆍ'\"`’‘“”]", "", text)
    return text.strip(" .-").strip()


def classify(key: str, rules: dict) -> tuple[str, str]:
    if key in set(rules.get("includeExact", [])):
        return "place", "includeExact"
    if key in set(rules.get("excludeExact", [])):
        return "excluded", "excludeExact"
    for word in rules.get("excludeKeywords", []):
        if word in key:
            return "excluded", f"keyword:{word}"
    return "place", "default"


def main() -> int:
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser()
    ap.add_argument("--month", required=True, help="target month, YYYY-MM")
    ap.add_argument("--out-dir", default="collector/out")
    ap.add_argument("--exclusions",
                    default=os.path.join(here, "..", "assets", "exclusions.json"))
    args = ap.parse_args()

    root = os.path.join(args.out_dir, args.month)
    with open(os.path.join(root, "raw_transactions.json"), encoding="utf-8") as fh:
        transactions = json.load(fh)["transactions"]
    with open(args.exclusions, encoding="utf-8") as fh:
        rules = json.load(fh)

    grouped: dict[str, dict] = {}
    ambiguous: list[dict] = []

    for tx in transactions:
        if MULTI_VENUE.search(tx["venue"]):
            ambiguous.append(tx)
            continue
        key = canonical(tx["venue"])
        if not key:
            ambiguous.append(tx)
            continue
        entry = grouped.setdefault(key, {
            "canonicalName": key,
            "displayName": tx["venue"],
            "rawNames": [],
            "addresses": [],
            "departments": [],
            "visits": 0,
            "totalAmount": 0,
            "firstSeen": tx["date"],
            "lastSeen": tx["date"],
        })
        entry["visits"] += 1
        entry["totalAmount"] += tx["amount"]
        entry["firstSeen"] = min(entry["firstSeen"], tx["date"])
        entry["lastSeen"] = max(entry["lastSeen"], tx["date"])
        for field, target in (("venue", "rawNames"), ("department", "departments"),
                              ("address", "addresses")):
            value = tx.get(field) or ""
            if value and value not in entry[target]:
                entry[target].append(value)

    buckets: dict[str, list[dict]] = {"places": [], "excluded": []}
    for entry in grouped.values():
        verdict, reason = classify(entry["canonicalName"], rules)
        entry["classification"] = reason
        buckets["places" if verdict == "place" else "excluded"].append(entry)
    for name in buckets:
        buckets[name].sort(key=lambda e: (-e["visits"], e["canonicalName"]))

    payload = {
        "month": args.month,
        **buckets,
        "ambiguousRows": ambiguous,
    }
    out_path = os.path.join(root, "normalized_places.json")
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=1)

    print(f"{args.month}: {len(grouped)} distinct venues -> {out_path}")
    print(f"  to geocode          : {len(buckets['places'])}")
    print(f"  excluded by name    : {len(buckets['excluded'])}")
    for entry in buckets["excluded"]:
        print(f"      {entry['canonicalName']} ({entry['classification']})")
    print(f"  multi-venue rows dropped: {len(ambiguous)}")
    for tx in ambiguous:
        print(f"      {tx['date']} {tx['department']}: {tx['venue']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
