#!/usr/bin/env python3
"""Transcribe the reviewer's verdicts into the review queue.

Usage:
    python3 apply_review.py --approve 까망염소 봉땅 --reject 금관유통
                            [--csv review_candidates.csv]

The reviewer decides; this script only writes down what they said. Every name
must be typed out, because the one thing the queue is for is that no agent
inferred a status: a `--all-pending` flag would hand exactly that inference
back to the caller, so there isn't one.

Only rows named on the command line are touched. Everything else — status,
notes, reviewer-added columns — round-trips unchanged, so a verdict on one
venue can never quietly land on its neighbour.
"""

from __future__ import annotations

import argparse
import csv
import os
import sys

# The queue's column order and the reader that preserves reviewer-added columns
# live with the stage that creates the file. Importing them keeps one definition
# of the queue's shape: a second copy here would drift the first time stage 4
# gains a column.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from geocode_candidates import load_existing  # noqa: E402

STATUSES = {"approve": "approved", "reject": "rejected"}


def resolve(rows: list[dict], verdicts: dict[str, str]) -> dict[int, str]:
    """Map row index -> new status, or raise SystemExit naming every problem.

    Errors are collected rather than raised on the first one: a reviewer reading
    back a list of ten names wants all the typos at once, not one per run.
    """
    index: dict[str, list[int]] = {}
    for position, row in enumerate(rows):
        index.setdefault((row.get("canonical_name") or "").strip(), []).append(position)

    problems = []
    targets: dict[int, str] = {}
    for name, status in verdicts.items():
        matches = index.get(name, [])
        if not matches:
            problems.append(f"no row with canonical_name {name!r}")
        elif len(matches) > 1:
            # docs/architecture.md treats one canonical name on two rows as
            # ambiguous. Writing both would decide which the reviewer meant.
            problems.append(f"{name!r} matches {len(matches)} rows — resolve the duplicate first")
        else:
            targets[matches[0]] = status

    if problems:
        raise SystemExit("nothing written:\n  " + "\n  ".join(problems))
    return targets


def parse_verdicts(approve: list[str], reject: list[str]) -> dict[str, str]:
    verdicts: dict[str, str] = {}
    both = sorted({n.strip() for n in approve} & {n.strip() for n in reject})
    if both:
        raise SystemExit("nothing written: named as both approved and rejected: " + ", ".join(both))
    for names, key in ((approve, "approve"), (reject, "reject")):
        for name in names:
            verdicts[name.strip()] = STATUSES[key]
    if not verdicts:
        raise SystemExit("name at least one venue with --approve or --reject")
    return verdicts


def write(path: str, rows: list[dict], columns: list[str]) -> None:
    """Write beside the target and rename, so a crash cannot truncate the queue."""
    temp = path + ".tmp"
    with open(temp, "w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({key: row.get(key, "") for key in columns})
    os.replace(temp, path)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--approve", nargs="*", default=[], metavar="NAME",
                    help="canonical_name of each venue the reviewer approved")
    ap.add_argument("--reject", nargs="*", default=[], metavar="NAME",
                    help="canonical_name of each venue the reviewer rejected")
    ap.add_argument("--csv", default="review_candidates.csv")
    args = ap.parse_args()

    verdicts = parse_verdicts(args.approve, args.reject)
    rows, columns = load_existing(args.csv)
    if not rows:
        raise SystemExit(f"nothing written: {args.csv} holds no rows")

    targets = resolve(rows, verdicts)

    changed = 0
    for position, status in sorted(targets.items()):
        row = rows[position]
        before = row.get("status", "")
        if before == status:
            print(f"  {row.get('canonical_name')}: already {status}")
            continue
        row["status"] = status
        changed += 1
        print(f"  {row.get('canonical_name')}: {before or '(blank)'} -> {status}")

    if not changed:
        print(f"{args.csv} unchanged — every named row already carried its verdict.")
        return 0

    write(args.csv, rows, columns)
    print(f"{changed} of {len(rows)} rows updated -> {args.csv}")
    print("Rows not named on the command line kept their status untouched.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
