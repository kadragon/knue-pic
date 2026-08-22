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

from collector.kinds import derive_kind
from collector.validate import (DatasetUnusable, as_number, normalize_name, parse_iso_date,
                                window_floor)

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
DEFAULT_ALIASES = Path("collector/aliases.json")
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
    kind: str
    address: str
    lat: float
    lng: float


def text(value: Any) -> str:
    """Trimmed text, or ``""``. Matches ``requireText`` in ``src/data/load.ts``."""
    return value.strip() if isinstance(value, str) else ""


def parse_float(value: str) -> float | None:
    """The number the text denotes, or ``None``. Finiteness is ``as_number``'s job, not this."""
    try:
        return float(value)
    except ValueError:
        return None


def load_aliases(path: Path) -> dict[str, str]:
    """``alias canonical_name`` -> ``representative canonical_name``, the operator's merge map.

    The disclosures spell one business several ways -- `신토불이교원대점` and `신토불이`,
    four spellings of `본도시락 오송점` -- and stage 3 of the collector merges only exact
    normalised matches on purpose (`docs/architecture.md` -> Build), so those arrive as separate
    approved rows and publish as separate places with their visits split between them. This file is
    where the reviewer says they are one business; nothing merges that is not written here.

    Keys and values are NFC (``normalize_name``) like every other join key in this module: the
    operator edits this file and the queue by hand, and a decomposed spelling in one of them would
    otherwise name a place the other does not have.

    A missing file is an empty map, not an error -- a repo that has never needed a merge has no
    reason to carry one.

    Fails closed on a self-alias and on a chain (a target that is itself a key). A chain has no
    defensible single answer -- resolving it would depend on dict order -- and both are far more
    likely to be a typo than an intent.
    """
    if not path.exists():
        return {}
    payload = read_json(path)
    if not isinstance(payload, dict):
        raise DatasetUnusable(f"{path} must be a JSON object of alias -> canonical name")

    aliases: dict[str, str] = {}
    for key, value in payload.items():
        alias = normalize_name(key) or ""
        target = normalize_name(value) if isinstance(value, str) else None
        if not alias or not target:
            raise DatasetUnusable(
                f"{path}: {key!r} -> {value!r} is not a usable canonical name pair")
        if alias == target:
            raise DatasetUnusable(f"{path}: {alias!r} is aliased to itself")
        aliases[alias] = target

    for alias, target in aliases.items():
        if target in aliases:
            raise DatasetUnusable(
                f"{path}: {alias!r} points at {target!r}, which is itself an alias for "
                f"{aliases[target]!r} — resolve the chain to a single representative")
    return aliases


def load_approved(path: Path, aliases: dict[str, str]) -> dict[str, Approved]:
    """Approved rows keyed by ``canonical_name``, minus the ones ``aliases`` merges away.

    The key is the canonical name because that is what the normalizer writes into
    ``normalized_places.json`` and therefore the only join available to the transaction pass. It is
    also the key ``collector/validate.py`` check 9 joins approvals on, through the ID map this
    module writes — so the build and the gate file a place under the same name or neither does.

    Both names are keyed in NFC (``normalize_name``). The operator edits this file by hand, so one
    business can arrive composed on one row and decomposed on another; keying on the raw code
    points would build it as two places with two IDs, and would write a ``name`` that check 9 —
    which normalizes too — then reads as belonging to a different row.

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
    except (OSError, UnicodeDecodeError, csv.Error) as cause:
        # The operator edits this file by hand, and Excel on a Korean Windows box saves CSV as
        # CP949 — neither a decode failure nor a malformed row inherits from OSError, so without
        # the wider tuple both escape as a traceback and the exit-2 contract is lost. Same three
        # causes `load_approvals` in `validate.py` catches.
        raise DatasetUnusable(f"{path} could not be read: {cause}") from cause

    # Every row's display name, not just the approved ones. The published `name` is this column,
    # and check 11 (`unique-name`) calls one business published twice a defect, so two rows carrying
    # one display name are two places the gate then rejects — whatever their statuses, since a
    # pending row is one operator edit away from being approved into that collision.
    display_rows: dict[str, list[int]] = {}
    canonical_rows: dict[str, list[int]] = {}
    for number, row in enumerate(rows, start=2):  # header is line 1
        name = normalize_name(row.get("display_name"))
        if name is not None:
            display_rows.setdefault(name, []).append(number)
        # The canonical name is indexed on the same any-status terms, because it is the key check 9
        # joins approvals on: `load_approvals` in `validate.py` calls a canonical name ambiguous the
        # moment a *second* row carries it, whatever that row's status. An approved-rows-only guard
        # here would build a place, mint it a permanent ID, and hand the gate a dataset it can only
        # refuse — the build and the gate disagreeing about what one name is.
        canonical = normalize_name(row.get("canonical_name"))
        if canonical is not None:
            canonical_rows.setdefault(canonical, []).append(number)

    approved: dict[str, Approved] = {}
    for number, row in enumerate(rows, start=2):
        if text(row.get("status")) != APPROVED:
            continue
        canonical = normalize_name(row.get("canonical_name")) or ""
        if not canonical:
            raise DatasetUnusable(f"{path} line {number}: approved row has no canonical_name")
        others = [line for line in canonical_rows.get(canonical, ()) if line != number]
        if others:
            raise DatasetUnusable(
                f"{path} line {number}: canonical_name {canonical!r} is on more than one row "
                f"(also line {others[0]}) — check 9 reads that as ambiguous whatever the other "
                "row's status; resolve the duplicate before building")

        # A merged spelling publishes no place of its own: `collect_transactions` sends its visits
        # to the representative instead. Skipping here rather than after the field checks is
        # deliberate — a row that publishes nothing must not be held to what a published row needs,
        # and the canonical-name guard above still ran, which is the one check 9 mirrors.
        if canonical in aliases:
            continue

        # `display_name` is what gets published as the place's `name`, so it carries two
        # obligations of its own. A blank one must not fall back to the canonical name: the queue
        # is what the operator reads, and a place named by a string that appears nowhere in it is
        # unreviewable — check 7 would reject the blank anyway, one deploy later. A repeated one is
        # the collision check 11 refuses to publish, on *any* row, approved or not; refusing it here
        # costs an operator one edit instead of a minted ID and a blocked deploy.
        display = normalize_name(row.get("display_name")) or ""
        if not display:
            raise DatasetUnusable(
                f"{path} line {number}: approved row {canonical!r} has no display_name — "
                "that column is the place's published name")
        others = [line for line in display_rows.get(display, ()) if line != number]
        if others:
            raise DatasetUnusable(
                f"{path} line {number}: display_name {display!r} is on more than one row "
                f"(also line {others[0]}) — resolve the duplicate before building")

        # The road address is what a visitor would type into a map; the parcel address is the
        # fallback for the rows Naver returned without one.
        address = text(row.get("road_address")) or text(row.get("address"))
        if not address:
            raise DatasetUnusable(f"{path} line {number}: approved row {display!r} has no address")

        # NFC like every other join key: `src/stats/search.ts` groups the filter options by
        # exact `category` string, so a decomposed spelling would render a second, visually
        # identical option hiding the composed one's places.
        category_path = text(row.get("category"))
        category = normalize_name(category_path.split(">")[0]) or UNCLASSIFIED_CATEGORY
        # From the whole path, not the truncated `category` above: the segment that separates a
        # café from a lunchbox shop is usually not the first one (`collector/kinds.py`).
        kind = derive_kind(category_path)

        # `float` parses "nan" and "inf" without complaint, and `json.dumps` then writes bare
        # `NaN`/`Infinity` — tokens no browser JSON parser accepts, which turns a data defect into
        # a whole dataset the site cannot load. `as_number` is the same finiteness test the gate
        # applies, so the build cannot emit a coordinate the gate would call unusable.
        lat = as_number(parse_float(text(row.get("lat"))))
        lng = as_number(parse_float(text(row.get("lng"))))
        if lat is None or lng is None:
            raise DatasetUnusable(
                f"{path} line {number}: approved row {display!r} has unusable coordinates "
                f"({row.get('lat')!r}, {row.get('lng')!r})")

        approved[canonical] = Approved(canonical, display, category, kind, address, lat, lng)

    # An alias pointing at a name no approved row carries is the silent-loss case this whole
    # mechanism exists to prevent: `collect_transactions` would resolve the merged spelling to that
    # name, find it unapproved, and drop every one of its visits with nothing said.
    for alias, target in sorted(aliases.items()):
        if target not in approved:
            raise DatasetUnusable(
                f"alias {alias!r} points at {target!r}, which is on no approved row — "
                "its visits would be dropped rather than merged")
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

    Both sides of the key are NFC (``normalize_name``): the normalizer's output and the review
    queue are separate files that need not agree on a spelling, and a mismatch here drops every
    visit of an approved place rather than reporting anything.

    Only ``places`` is indexed. ``excluded`` holds the venues a classification rule rejected
    (a wholesaler, a print shop); their transactions must not reach the dataset, and leaving them
    out of the index is what drops them.
    """
    places = normalized.get("places") if isinstance(normalized, dict) else None
    if not isinstance(places, list):
        raise DatasetUnusable(f"{path} has no 'places' list")

    index: dict[str, str] = {}
    for place in places:
        if not isinstance(place, dict):
            continue
        canonical = normalize_name(place.get("canonicalName")) or ""
        if not canonical:
            continue
        raw_names = place.get("rawNames")
        for raw in raw_names if isinstance(raw_names, list) else []:
            name = normalize_name(raw) or ""
            if name:
                index[name] = canonical
    return index


def collect_transactions(
    out_dir: Path,
    approved: dict[str, Approved],
    aliases: dict[str, str],
    window_start: date,
    window_end: date,
) -> tuple[dict[str, list[dict[str, Any]]], int, int]:
    """Per-canonical-name transactions inside the window, the month count, and the unusable count.

    A transaction is kept only when its venue maps to an *approved* place. Every other outcome --
    a pending row, a rejected one, an excluded venue, a shared-receipt line the normalizer could
    not attribute -- is a venue this pass simply does not find, which is the correct result for all
    four, and is not counted as unusable.

    A row belonging to an approved place that is dropped anyway -- an unparseable date, a
    negative or non-numeric amount -- *is* counted and reported. Visits are the product's whole
    ranking signal, so an extraction regression that quietly halves a place's count would move it
    down the list with nothing saying so. Being outside the window is not a defect and is not
    counted; that is the trim doing its job.
    """
    by_place: dict[str, list[dict[str, Any]]] = {}
    unusable = 0
    months = month_dirs(out_dir)
    if not months:
        raise DatasetUnusable(
            f"{out_dir} holds no month directory with both normalized_places.json and "
            "raw_transactions.json — nothing to build from. Run the collection skill first")
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
            canonical = index.get(normalize_name(row.get("venue")) or "")
            # The merge happens here, before the approval test: a spelling the operator merged away
            # is not approved under its own name, so resolving it afterwards would drop the visits
            # this map exists to keep. `load_approved` has already refused any alias whose target is
            # unapproved, so the lookup cannot land on a name that then fails the test below.
            if canonical is not None:
                canonical = aliases.get(canonical, canonical)
            if canonical is None or canonical not in approved:
                continue
            when = row.get("date")
            # `parse_iso_date`, not `date.fromisoformat`: on 3.11+ the latter also accepts
            # `20260703` and `2026-W28-1`, and the raw string is what gets written, so the build
            # would emit a date its own gate rejects at check 5. The gate's parser is the one that
            # decides what a date is.
            parsed = parse_iso_date(when)
            if parsed is None:
                unusable += 1
                continue
            if parsed < window_start or parsed > window_end:
                continue
            amount = as_number(row.get("amount"))
            if amount is None or amount < 0:
                unusable += 1
                continue
            # `json` round-trips an integral float as `230000.0`; the wire format and every
            # disclosed figure are whole won, so the integral case is normalised back to `int`.
            amount = int(amount) if amount.is_integer() else amount
            by_place.setdefault(canonical, []).append({"date": when, "amount": amount})

    for transactions in by_place.values():
        transactions.sort(key=lambda item: (item["date"], item["amount"]))
    return by_place, len(months), unusable


def load_id_map(path: Path) -> dict[str, str]:
    """The persisted ``canonical_name`` -> id map; an absent file is a first run, not an error.

    Keys are read trimmed and in NFC, matching ``load_approved``. The file is committed and edited
    by hand, so
    a decomposed key would otherwise name no approved place and the place would be minted a second
    ID — the one thing the map exists to prevent. Two keys that normalize to one are fatal: which
    ID the place keeps is exactly the question this module refuses to answer for the operator.
    """
    if not path.exists():
        return {}
    parsed = read_json(path)
    if not isinstance(parsed, dict) or not all(
            isinstance(key, str) and isinstance(value, str) for key, value in parsed.items()):
        raise DatasetUnusable(f"{path} must be a JSON object of name -> id strings")
    id_map: dict[str, str] = {}
    for key, value in parsed.items():
        name = normalize_name(key) or key
        if name in id_map and id_map[name] != value:
            raise DatasetUnusable(
                f"{path}: {name!r} is mapped to both {id_map[name]!r} and {value!r} — two "
                "spellings of one name; resolve the duplicate before building")
        id_map[name] = value
    return id_map


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
            "kind": approved[name].kind,
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
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(path.name + ".tmp")
        temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
                             encoding="utf-8")
        os.replace(temporary, path)
    except OSError as cause:
        raise DatasetUnusable(f"{path} could not be written: {cause}") from cause


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build data/places.json from approved review rows.")
    parser.add_argument("--candidates", type=Path, default=DEFAULT_CANDIDATES,
                        help="review queue CSV (default: review_candidates.csv)")
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR,
                        help="collector intermediates root (default: collector/out)")
    parser.add_argument("--id-map", type=Path, default=DEFAULT_ID_MAP,
                        help="persistent canonical ID map (default: collector/id_map.json)")
    parser.add_argument("--aliases", type=Path, default=DEFAULT_ALIASES,
                        help="spelling merge map (default: collector/aliases.json)")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT,
                        help="dataset to write (default: data/places.json)")
    parser.add_argument("--updated-at", type=date.fromisoformat, default=None,
                        help="ISO date anchoring the rolling window (default: today)")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    updated_at = args.updated_at or date.today()
    window_start = window_floor(updated_at)

    # The writes are inside the `try` with everything else: an unwritable target or a full disk is
    # a run that could not proceed, and exit 2 is what says so. Escaping as a traceback would look
    # like a crash to the operator and to any script reading the exit code.
    try:
        aliases = load_aliases(args.aliases)
        approved = load_approved(args.candidates, aliases)
        transactions, months, unusable = collect_transactions(
            args.out_dir, approved, aliases, window_start, updated_at)
        id_map = load_id_map(args.id_map)
        dataset = build(approved, transactions, id_map, updated_at)
        if approved and months and not dataset["places"]:
            # Inputs were present and approvals existed, yet nothing survived — every transaction
            # was dropped or trimmed. The no-month-data guard does not cover this: the months are
            # there, so the build would write `places: []` and exit 0, and the gate passes an empty
            # dataset (it has no minimum-place check), so CI would publish a map with nothing on
            # it. An upstream date-format change is enough to trigger it.
            raise DatasetUnusable(
                f"{len(approved)} approved row(s) and {months} month(s) of data produced no "
                "publishable place — every transaction was dropped or fell outside the window; "
                "check the collector's output before publishing")
        write_json(args.id_map, dict(sorted(id_map.items())))
        write_json(args.output, dataset)
    except DatasetUnusable as cause:
        print(f"cannot build: {cause}", file=sys.stderr)
        return EXIT_UNUSABLE

    visits = sum(len(place["transactions"]) for place in dataset["places"])
    print(f"{args.output}: {len(dataset['places'])} place(s), {visits} transaction(s) "
          f"from {months} month(s), window {window_start} to {updated_at} "
          f"({len(approved)} approved row(s) in {args.candidates})")
    if unusable:
        # Not fatal, but never silent: these rows belong to approved places and were dropped for a
        # defect, so an extraction regression shows up here instead of as an unexplained rank move.
        print(f"warning: dropped {unusable} transaction(s) of approved places with an unusable "
              f"date or amount", file=sys.stderr)
    return EXIT_OK


if __name__ == "__main__":
    raise SystemExit(main())
