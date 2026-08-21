"""Build ``data/places.json`` from approved review rows and the collected transactions.

This is step 7 of ``docs/workflows.md`` -> ``data-update``, the hole between the collector (which
fills ``review_candidates.csv``; implemented as the ``knue-expense-collect`` skill) and
``collector/validate.py`` (which gates publication). It reads only files the operator already has
and writes exactly two: the dataset and the canonical ID map.

Two invariants shape everything below.

**Only approved rows publish** (``AGENTS.md`` Golden Principle 2). A row is copied into the dataset
when its ``status`` is exactly ``approved``; anything else -- pending, rejected, blank, a second row
sharing the same ``canonical_name`` -- yields no place. Ambiguity is never resolved in favour of
publishing: two approved rows for one canonical name stop the run.

**Canonical IDs survive across runs** (``docs/architecture.md`` -> Canonical ID). The map in
``collector/id_map.json`` is the memory; losing it silently resets every rank history, so it is
committed, appended to and never rewritten. An ID is assigned once and never reused, including
after the place leaves the queue.

The rolling-window bounds are imported from ``collector.validate`` rather than restated, so the
build and the gate that judges it cannot drift apart.

``collector/`` is never imported by ``src/`` and never imports it; this module is standard library
only.
"""

from __future__ import annotations

# `docs/runbook.md` -> Prerequisites declares Python 3.11+ for the collector; nothing here may use
# a newer stdlib name.
import argparse
import csv
import json
import os
import sys
import urllib.parse
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any, Iterable

from collector.validate import DatasetUnusable, as_number, window_floor

# `restaurant_%06d`, assigned once and never reused (`docs/architecture.md` -> Canonical ID).
ID_FORMAT = "restaurant_%06d"

# The loader rejects a place whose `category` is empty (`src/data/load.ts` -> `requireText`), and
# the CSV's category is a Naver taxonomy path (`한식>육류,고기요리`) whose first segment is the
# cuisine the UI shows. A row that was classified but carries no category is published as `기타`
# rather than dropped: it is approved, so a human already decided it belongs on the map.
UNCLASSIFIED_CATEGORY = "기타"

# A search link, not an invented place ID. The collector never learns Naver's internal place id, so
# composing one would be a fabrication; a search URL is a claim the data supports. `map.naver.com`
# is a `naver.com` host, so `requireNaverUrl` in `src/data/load.ts` and check 10 both accept it.
NAVER_SEARCH_PREFIX = "https://map.naver.com/p/search/"

DEFAULT_CANDIDATES = Path("review_candidates.csv")
DEFAULT_OUT_DIR = Path("collector/out")
DEFAULT_ID_MAP = Path("collector/id_map.json")
DEFAULT_OUTPUT = Path("data/places.json")

APPROVED = "approved"

EXIT_OK = 0
# Mirrors `collector/validate.py`: 2 means the run itself could not proceed. There is no exit 1
# here -- this module either produces a dataset or refuses to.
EXIT_UNUSABLE = 2

REQUIRED_CSV_COLUMNS = ("status", "canonical_name", "display_name", "category",
                        "address", "road_address", "lat", "lng")


@dataclass(frozen=True)
class Approved:
    """One approved review row, with the fields the dataset needs already parsed."""

    canonical_name: str
    display_name: str
    category: str
    address: str
    lat: float
    lng: float


def text(value: Any) -> str:
    """Trimmed text, or ``""``. Matches ``requireText`` in ``src/data/load.ts``."""
    return value.strip() if isinstance(value, str) else ""


def load_approved(path: Path) -> dict[str, Approved]:
    """Approved rows keyed by ``canonical_name``.

    The key is the canonical name because that is what the normalizer writes into
    ``normalized_places.json`` and therefore the only join available to the transaction pass.
    ``review_candidates.csv`` has no ``id`` column; moving this join onto the canonical ID is the
    follow-up in ``backlog.md`` that this module's ID map unblocks.

    Fails closed. A duplicated canonical name, a missing coordinate or an unparseable one on an
    *approved* row raises: with no defensible answer to "which row was approved?", publishing
    either is exactly what Golden Principle 2 forbids.
    """
    try:
        with path.open(encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            if reader.fieldnames is None:
                raise DatasetUnusable(f"{path} is empty — no header row")
            missing = set(REQUIRED_CSV_COLUMNS) - set(reader.fieldnames)
            if missing:
                raise DatasetUnusable(
                    f"{path} is missing column(s): {', '.join(sorted(missing))}")
            rows = list(reader)
    except OSError as cause:
        raise DatasetUnusable(f"{path} could not be read: {cause}") from cause

    approved: dict[str, Approved] = {}
    for number, row in enumerate(rows, start=2):  # header is line 1
        if text(row.get("status")) != APPROVED:
            continue
        canonical = text(row.get("canonical_name"))
        if not canonical:
            raise DatasetUnusable(f"{path} line {number}: approved row has no canonical_name")
        if canonical in approved:
            raise DatasetUnusable(
                f"{path} line {number}: canonical_name {canonical!r} is approved on two rows — "
                "resolve the duplicate before building")

        display = text(row.get("display_name")) or canonical
        # The road address is what a visitor would type into a map; the parcel address is the
        # fallback for the rows Naver returned without one.
        address = text(row.get("road_address")) or text(row.get("address"))
        if not address:
            raise DatasetUnusable(f"{path} line {number}: approved row {display!r} has no address")

        category = text(row.get("category")).split(">")[0].strip() or UNCLASSIFIED_CATEGORY

        try:
            lat = float(text(row.get("lat")))
            lng = float(text(row.get("lng")))
        except ValueError as cause:
            raise DatasetUnusable(
                f"{path} line {number}: approved row {display!r} has unusable coordinates "
                f"({row.get('lat')!r}, {row.get('lng')!r})") from cause

        approved[canonical] = Approved(canonical, display, category, address, lat, lng)
    return approved


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, ValueError) as cause:
        raise DatasetUnusable(f"{path} could not be read as JSON: {cause}") from cause


def month_dirs(out_dir: Path) -> list[Path]:
    """Every ``collector/out/<month>/`` holding both files this build needs, oldest first.

    A month directory missing one of the two files is skipped rather than fatal: an interrupted
    collection leaves a partial directory behind, and the months that did complete are still
    publishable. The summary reports how many months were read so a silent skip is visible.
    """
    if not out_dir.is_dir():
        return []
    found = [child for child in sorted(out_dir.iterdir())
             if (child / "normalized_places.json").is_file()
             and (child / "raw_transactions.json").is_file()]
    return found


def raw_name_index(normalized: Any, path: Path) -> dict[str, str]:
    """``raw venue name`` -> ``canonicalName``, for one month.

    Only ``places`` is indexed. ``excluded`` holds the venues a classification rule rejected
    (a wholesaler, a print shop); their transactions must not reach the dataset, and leaving them
    out of the index is what drops them.
    """
    places = normalized.get("places") if isinstance(normalized, dict) else None
    if not isinstance(places, list):
        raise DatasetUnusable(f"{path} has no 'places' list")

    index: dict[str, str] = {}
    for place in places:
        canonical = text(place.get("canonicalName")) if isinstance(place, dict) else ""
        if not canonical:
            continue
        raw_names = place.get("rawNames")
        for raw in raw_names if isinstance(raw_names, list) else []:
            name = text(raw)
            if name:
                index[name] = canonical
    return index


def collect_transactions(
    out_dir: Path,
    approved: dict[str, Approved],
    window_start: date,
    window_end: date,
) -> tuple[dict[str, list[dict[str, Any]]], int]:
    """Per-canonical-name transactions inside the window, plus the month count.

    A transaction is kept only when its venue maps to an *approved* place. Every other outcome --
    a pending row, a rejected one, an excluded venue, a shared-receipt line the normalizer could
    not attribute -- is a venue this pass simply does not find, which is the correct result for all
    four.
    """
    by_place: dict[str, list[dict[str, Any]]] = {}
    months = month_dirs(out_dir)
    for month in months:
        index = raw_name_index(read_json(month / "normalized_places.json"),
                               month / "normalized_places.json")
        payload = read_json(month / "raw_transactions.json")
        rows = payload.get("transactions") if isinstance(payload, dict) else None
        if not isinstance(rows, list):
            raise DatasetUnusable(f"{month / 'raw_transactions.json'} has no 'transactions' list")

        for row in rows:
            if not isinstance(row, dict):
                continue
            canonical = index.get(text(row.get("venue")))
            if canonical is None or canonical not in approved:
                continue
            when = row.get("date")
            if not isinstance(when, str):
                continue
            try:
                parsed = date.fromisoformat(when)
            except ValueError:
                continue
            if parsed < window_start or parsed > window_end:
                continue
            amount = as_number(row.get("amount"))
            if amount is None or amount < 0:
                continue
            # `json` round-trips an integral float as `230000.0`; the wire format and every
            # disclosed figure are whole won, so the integral case is normalised back to `int`.
            amount = int(amount) if amount.is_integer() else amount
            by_place.setdefault(canonical, []).append({"date": when, "amount": amount})

    for transactions in by_place.values():
        transactions.sort(key=lambda item: (item["date"], item["amount"]))
    return by_place, len(months)


def load_id_map(path: Path) -> dict[str, str]:
    """The persisted ``canonical_name`` -> id map; an absent file is a first run, not an error."""
    if not path.exists():
        return {}
    parsed = read_json(path)
    if not isinstance(parsed, dict) or not all(
            isinstance(key, str) and isinstance(value, str) for key, value in parsed.items()):
        raise DatasetUnusable(f"{path} must be a JSON object of name -> id strings")
    return dict(parsed)


def next_index(id_map: dict[str, str]) -> int:
    """One past the highest number ever assigned.

    Derived from the map's own values rather than from its size, so an entry removed by hand does
    not hand its number to a different business. IDs are never reused
    (``docs/architecture.md`` -> Canonical ID).
    """
    highest = 0
    for value in id_map.values():
        _, _, digits = value.rpartition("_")
        if digits.isdigit():
            highest = max(highest, int(digits))
    return highest + 1


def assign_ids(id_map: dict[str, str], names: Iterable[str]) -> dict[str, str]:
    """Extend the map with any unseen name, in a stable order. Existing entries never move."""
    counter = next_index(id_map)
    for name in sorted(names):
        if name not in id_map:
            id_map[name] = ID_FORMAT % counter
            counter += 1
    return id_map


def naver_search_url(name: str) -> str:
    """A Naver Map search link for the place name."""
    return NAVER_SEARCH_PREFIX + urllib.parse.quote(name, safe="")


def build(
    approved: dict[str, Approved],
    transactions: dict[str, list[dict[str, Any]]],
    id_map: dict[str, str],
    updated_at: date,
) -> dict[str, Any]:
    """Assemble the dataset. A place with no transaction in the window is not published."""
    with_visits = {name: rows for name, rows in transactions.items() if rows}
    assign_ids(id_map, with_visits)

    places = [
        {
            "id": id_map[name],
            "name": approved[name].display_name,
            "category": approved[name].category,
            "address": approved[name].address,
            "lat": approved[name].lat,
            "lng": approved[name].lng,
            "naverUrl": naver_search_url(approved[name].display_name),
            "transactions": rows,
        }
        for name, rows in with_visits.items()
    ]
    places.sort(key=lambda place: place["id"])
    return {"updatedAt": updated_at.isoformat(), "places": places}


def write_json(path: Path, payload: Any) -> None:
    """Write via a temp file and rename, so an interrupted run cannot truncate the target."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
                         encoding="utf-8")
    os.replace(temporary, path)


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build data/places.json from approved review rows.")
    parser.add_argument("--candidates", type=Path, default=DEFAULT_CANDIDATES,
                        help="review queue CSV (default: review_candidates.csv)")
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR,
                        help="collector intermediates root (default: collector/out)")
    parser.add_argument("--id-map", type=Path, default=DEFAULT_ID_MAP,
                        help="persistent canonical ID map (default: collector/id_map.json)")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT,
                        help="dataset to write (default: data/places.json)")
    parser.add_argument("--updated-at", type=date.fromisoformat, default=None,
                        help="ISO date anchoring the rolling window (default: today)")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    updated_at = args.updated_at or date.today()
    window_start = window_floor(updated_at)

    try:
        approved = load_approved(args.candidates)
        transactions, months = collect_transactions(
            args.out_dir, approved, window_start, updated_at)
        id_map = load_id_map(args.id_map)
        dataset = build(approved, transactions, id_map, updated_at)
    except DatasetUnusable as cause:
        print(f"cannot build: {cause}", file=sys.stderr)
        return EXIT_UNUSABLE

    write_json(args.id_map, dict(sorted(id_map.items())))
    write_json(args.output, dataset)

    visits = sum(len(place["transactions"]) for place in dataset["places"])
    print(f"{args.output}: {len(dataset['places'])} place(s), {visits} transaction(s) "
          f"from {months} month(s), window {window_start} to {updated_at} "
          f"({len(approved)} approved row(s) in {args.candidates})")
    return EXIT_OK


if __name__ == "__main__":
    raise SystemExit(main())
