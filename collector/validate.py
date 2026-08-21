"""The publication gate for ``data/places.json`` — the nine checks of PRD §32.

``data/places.json`` is the entire API of this product and it ships verbatim to the public site,
so this module is the last thing that stands between a bad row and a published one. It is wired
into the monthly cycle at ``docs/workflows.md`` step 8 and ``docs/runbook.md`` -> Data Update; a
non-zero exit means *do not publish*.

The nine checks are the invariants listed in ``docs/architecture.md`` -> Data Contract. Two of the
repo's Golden Principles name this file as their enforcement mechanism, so the failure mode that
matters is a check that passes when it should not — never a crash, and never a warning.

Every check runs over the whole file and every violation is reported. Stopping at the first defect
would make the operator re-run the monthly cycle once per bad row.

``collector/`` is never imported by ``src/`` and never imports it; this module is standard library
only and has no dependency on the web build.
"""

from __future__ import annotations

# `docs/runbook.md` -> Prerequisites declares Python 3.11+ for the collector, so nothing here may
# use a newer stdlib name. That is why the helpers below return parsed values instead of booleans:
# `typing.TypeIs`, which would give a type checker the same narrowing, is 3.13+.
import argparse
import csv
import json
import math
import re
import sys
import unicodedata
import urllib.parse
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any, Iterable

# Coordinate bounds are deliberately tighter than the loader's. `src/data/load.ts` accepts the
# global +/-90 / +/-180 range because it is a wire-format parser; this is the quality gate, and a
# geocoding mis-hit that lands a 청주 restaurant in Japan or the Pacific is exactly the defect the
# `region_ok` column in `review_candidates.csv` exists to flag. See `docs/architecture.md`.
KOREA_LAT_MIN = 33.0
KOREA_LAT_MAX = 39.0
KOREA_LNG_MIN = 124.0
KOREA_LNG_MAX = 132.0

# The published file keeps the most recent 12 months, anchored on `updatedAt`
# (`docs/architecture.md` -> Rolling window). The collector may retain 13 internally; only 12 ship.
ROLLING_WINDOW_MONTHS = 12

# `naverUrl` is the one dataset string the site puts in an `href`, so `src/data/load.ts` demands
# an https URL on one of these hosts rather than merely non-empty text. Check 10 exists to be no
# weaker than that loader; a value this gate waves through would blank the published site.
NAVER_URL_HOSTS = ("naver.com", "naver.me")

# Plain ASCII LDH labels — see `naver_url_or_none` for why the host is held to this shape.
ASCII_HOST_RE = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*")

DEFAULT_CANDIDATES = Path("review_candidates.csv")

EXIT_OK = 0
EXIT_INVALID = 1
EXIT_UNUSABLE = 2

CHECK_NAMES = {
    1: "unique-id",
    2: "coordinates-present",
    3: "coordinates-in-range",
    4: "amount-non-negative",
    5: "iso-date",
    6: "rolling-window",
    7: "name-present",
    8: "address-present",
    9: "review-approved",
    # Beyond the nine: `src/data/load.ts` rejects the *whole file* when `category` or `naverUrl` is
    # unusable, so a dataset this gate passes could still leave the site with zero places rendered.
    # A gate weaker than the loader it guards is not a gate.
    10: "loader-parity",
}


class DatasetUnusable(Exception):
    """The run itself is broken — file missing, unreadable, not JSON, root not an object.

    Distinct from a check failure so a CI step can tell "the data is bad" (exit 1) from "the
    validator could not run" (exit 2). Both stop publication.
    """


@dataclass(frozen=True)
class Violation:
    """One defect. ``check`` is ``None`` for structural damage that precedes any numbered check."""

    check: int | None
    detail: str

    def render(self) -> str:
        if self.check is None:
            return f"structure: {self.detail}"
        return f"check {self.check} {CHECK_NAMES[self.check]}: {self.detail}"


def describe(value: Any) -> str:
    """Short, quotable rendering of a rejected value — enough to find it in the JSON."""
    if isinstance(value, str):
        return f'"{value}"'
    if isinstance(value, float) and not math.isfinite(value):
        return repr(value)
    try:
        return json.dumps(value, ensure_ascii=False)
    except (TypeError, ValueError):
        return repr(value)


def parse_iso_date(value: Any) -> date | None:
    """The parsed date, or ``None`` when the value is not a real ``YYYY-MM-DD`` calendar date.

    Returns the value rather than a boolean so every caller that needs the date gets it from the
    same check that validated it — a separate re-parse is what drifts.

    ``date.fromisoformat`` alone accepts ``20260203`` and, on newer Pythons, other ISO 8601 forms,
    so the length and separators are checked explicitly: the wire format is the narrow one.
    """
    if not isinstance(value, str) or len(value) != 10 or value[4] != "-" or value[7] != "-":
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def as_number(value: Any) -> float | None:
    """The value as a finite number, or ``None``.

    JSON ``true`` deserializes to a Python ``bool``, which is an ``int``, so it is rejected
    explicitly — otherwise ``"lat": true`` would validate as the number 1.
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        # A syntactically valid JSON integer can exceed the float range (`10**400`); `math.isfinite`
        # converts before testing, so it raises rather than answering.
        return float(value) if math.isfinite(value) else None
    except OverflowError:
        return None


def window_floor(anchor: date) -> date:
    """First day of the oldest month the published window covers.

    Anchored on the calendar month, not on ``anchor``'s day, because that is what the app does with
    the data: `src/stats/histogram.ts` buckets the ``ROLLING_WINDOW_MONTHS`` calendar months ending
    with the anchor's own month, and `src/stats/period.ts` -> ``isWithinWindow`` is half-open at the
    start. A day-anchored floor would admit transactions that every 1y view then ignores — the
    histogram bars would sum to less than the count printed beside them, with nothing reporting it.
    """
    total = anchor.year * 12 + (anchor.month - 1) - (ROLLING_WINDOW_MONTHS - 1)
    year, month = divmod(total, 12)
    return date(year, month + 1, 1)


def naver_url_or_none(value: Any) -> str | None:
    """The trimmed URL, or ``None`` when it is not an https URL on an allowed Naver host.

    Mirrors ``requireNaverUrl`` in ``src/data/load.ts``, down to the leading dot on the suffix
    test — ``evilnaver.com`` ends with ``naver.com`` and must not pass.
    """
    text = text_or_none(value)
    if text is None:
        return None
    # WHATWG (what `new URL` in the browser and in `src/data/load.ts` implements) treats a backslash
    # as an authority separator for special schemes; `urlsplit` treats it as an ordinary character.
    # Left alone, `https://evil.com\\@naver.com/x` parses here as userinfo `evil.com\\` on host
    # `naver.com` and passes, while the loader reads host `evil.com` and rejects the whole file —
    # the gate would publish a dataset that blanks the site. Normalising first removes that gap.
    #
    # The two parsers still disagree elsewhere (`https:/naver.com`, a fullwidth `naver。com`), but
    # only in the safe direction — this gate rejecting what the loader would accept, which stops
    # publication and shows the operator, instead of reaching a visitor.
    try:
        # Both calls are inside the `try` because both raise on input `new URL` merely rejects:
        # `urlsplit` raises on a malformed IPv6 authority (`https://[::1/x`), and it range-checks
        # the port only when the attribute is read, so that access is the check, not a lookup.
        # An escaping exception would abort the whole run with a traceback — the one outcome this
        # module's docstring rules out — instead of reporting a check-10 violation.
        parsed = urllib.parse.urlsplit(text.replace("\\", "/"))
        parsed.port
    except ValueError:
        return None
    if parsed.scheme != "https":
        return None
    host = (parsed.hostname or "").lower()
    if not any(host == allowed or host.endswith(f".{allowed}") for allowed in NAVER_URL_HOSTS):
        return None
    # WHATWG runs IDNA on the host; nothing in the standard library reproduces it. Python's `idna`
    # codec is IDNA2003 and is the looser of the two — it accepts `xn--b0b`, which `new URL`
    # rejects — so mirroring it closes one case and leaves the next. Instead of chasing that, the
    # host is required to be plain ASCII letters/digits/hyphens with no `xn--` label at all. For a
    # host in that shape WHATWG's IDNA step is a no-op, so anything this gate accepts the loader
    # accepts too — the one-directional invariant holds by construction rather than by corpus.
    # It costs nothing real: every URL the collector emits is an ASCII `*.naver.com` address.
    if not ASCII_HOST_RE.fullmatch(host):
        return None
    if any(label.startswith("xn--") for label in host.split(".")):
        return None
    return text


def text_or_none(value: Any) -> str | None:
    """The trimmed string, or ``None`` when the value is not usable text.

    Trimming matches ``requireText`` in ``src/data/load.ts``: the loader stores the trimmed value,
    so ``"restaurant_1 "`` and ``"restaurant_1"`` are the same id downstream and the uniqueness
    check has to see them that way too.
    """
    if not isinstance(value, str):
        return None
    trimmed = value.strip()
    return trimmed or None


def normalize_name(value: Any) -> str | None:
    """``text_or_none`` in NFC, for the values a join is keyed on.

    A Korean name reaches the queue from two hands — a macOS paste carries the decomposed spelling,
    Naver's API the composed one — and the two are code-point-unequal while naming one business.
    Every name-keyed join in the collector goes through this, so the build and check 9 cannot
    disagree about what one name is. Names only, which is a scope and not a claim about the other
    fields: ``src/stats/search.ts`` does group places by exact ``category`` string, so that field has
    the same defect — tracked in ``backlog.md`` rather than fixed here, because it needs the browser
    side to agree too.
    """
    text = text_or_none(value)
    return unicodedata.normalize("NFC", text) if text is not None else None


def _reject_json_constant(constant: str) -> Any:
    """Python's ``json`` accepts ``NaN``/``Infinity``; RFC 8259 and the browser do not.

    Without this the gate can certify a file that `Response.json()` refuses outright
    (`src/data/load.ts`), publishing a site that loads no places at all.
    """
    raise ValueError(f"{constant} is not valid JSON — the browser's parser rejects it")


def load_dataset(path: Path) -> dict[str, Any]:
    """Read and JSON-parse the dataset. Anything short of a JSON object is unusable."""
    try:
        raw = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as cause:
        raise DatasetUnusable(f"{path} could not be read: {cause}") from cause

    try:
        parsed = json.loads(raw, parse_constant=_reject_json_constant)
    except ValueError as cause:
        # ValueError, not JSONDecodeError: `_reject_json_constant` raises a plain ValueError, and
        # JSONDecodeError is itself a ValueError, so one handler covers both.
        raise DatasetUnusable(f"{path} is not valid JSON: {cause}") from cause

    if not isinstance(parsed, dict):
        raise DatasetUnusable(f"{path} must contain a JSON object, got {describe(parsed)}")
    return parsed


def load_approvals(path: Path) -> tuple[dict[str, str], set[str]]:
    """Map ``display_name`` -> ``status`` from the review queue, plus the ambiguous names.

    Keys are NFC (``normalize_name``), so the two spellings of one Korean name are one key. That
    makes a name approved in both forms a *duplicate* rather than two independent rows — the
    ambiguity is surfaced, not resolved.

    A name appearing on two rows is returned in the second value rather than resolved: with two
    rows there is no defensible answer to "was this one approved?", so check 9 reports it.
    """
    try:
        with path.open(encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            if reader.fieldnames is None:
                raise DatasetUnusable(f"{path} is empty — no header row")
            missing = {"status", "display_name"} - set(reader.fieldnames)
            if missing:
                raise DatasetUnusable(
                    f"{path} is missing required column(s): {', '.join(sorted(missing))}"
                )
            rows = list(reader)
    except (OSError, UnicodeDecodeError, csv.Error) as cause:
        # The operator edits this file by hand, and Excel on a Korean Windows box saves CSV as
        # CP949 — a decode failure here is a broken run (exit 2), not a data defect (exit 1).
        raise DatasetUnusable(f"{path} could not be read: {cause}") from cause

    approvals: dict[str, str] = {}
    duplicates: set[str] = set()
    for row in rows:
        name = normalize_name(row.get("display_name"))
        if name is None:
            continue
        if name in approvals:
            duplicates.add(name)
        approvals[name] = (row.get("status") or "").strip()
    return approvals, duplicates


def validate(
    dataset: dict[str, Any],
    approvals: dict[str, str],
    duplicate_names: Iterable[str] = (),
) -> list[Violation]:
    """Run all nine checks and return every violation found, in check order per place."""
    violations: list[Violation] = []
    duplicates = set(duplicate_names)

    # `updatedAt` anchors the rolling window (and every period window in `src/data/types.ts`).
    # When it is unusable, check 6 has no anchor: report that once and let the other checks run,
    # rather than suppressing eight working checks behind one bad field.
    updated_at = dataset.get("updatedAt")
    window_end = parse_iso_date(updated_at)
    window_start: date | None = None
    if window_end is None:
        violations.append(
            Violation(6, f"updatedAt is not a real calendar date: {describe(updated_at)}")
        )
    else:
        window_start = window_floor(window_end)

    places = dataset.get("places")
    if not isinstance(places, list):
        violations.append(Violation(None, f"places must be an array, got {describe(places)}"))
        return violations

    seen_ids: set[str] = set()
    for index, place in enumerate(places):
        path = f"places[{index}]"
        if not isinstance(place, dict):
            violations.append(Violation(None, f"{path} must be an object, got {describe(place)}"))
            continue
        violations.extend(
            _validate_place(place, path, seen_ids, approvals, duplicates, window_start, window_end)
        )

    return violations


def _validate_place(
    place: dict[str, Any],
    path: str,
    seen_ids: set[str],
    approvals: dict[str, str],
    duplicates: set[str],
    window_start: date | None,
    window_end: date | None,
) -> list[Violation]:
    violations: list[Violation] = []

    # Check 1 — unique id. A missing or blank id is reported here too: uniqueness is undecidable
    # without one, and an unidentified place cannot keep a rank history across months.
    place_id = text_or_none(place.get("id"))
    if place_id is None:
        violations.append(
            Violation(1, f"{path}.id must be a non-empty string, got {describe(place.get('id'))}")
        )
    elif place_id in seen_ids:
        violations.append(Violation(1, f'{path}.id is a duplicate: "{place_id}"'))
    else:
        seen_ids.add(place_id)

    # Checks 2 and 3 — coordinates present, then in range. Range is only meaningful once the value
    # is a real number, so a missing coordinate is not also reported as out of range.
    for key, low, high in (
        ("lat", KOREA_LAT_MIN, KOREA_LAT_MAX),
        ("lng", KOREA_LNG_MIN, KOREA_LNG_MAX),
    ):
        raw = place.get(key)
        value = as_number(raw)
        if value is None:
            violations.append(
                Violation(2, f"{path}.{key} must be a finite number, got {describe(raw)}")
            )
        elif not low <= value <= high:
            violations.append(
                Violation(
                    3,
                    f"{path}.{key} is outside the Korea bounds {low}..{high}: {describe(raw)}",
                )
            )

    # Checks 4, 5 and 6 — per transaction.
    transactions = place.get("transactions")
    if not isinstance(transactions, list):
        violations.append(
            Violation(None, f"{path}.transactions must be an array, got {describe(transactions)}")
        )
    else:
        for tx_index, transaction in enumerate(transactions):
            tx_path = f"{path}.transactions[{tx_index}]"
            if not isinstance(transaction, dict):
                violations.append(
                    Violation(None, f"{tx_path} must be an object, got {describe(transaction)}")
                )
                continue
            violations.extend(
                _validate_transaction(transaction, tx_path, window_start, window_end)
            )

    # Checks 7, 8 and 10 — every field `parsePlace` in `src/data/load.ts` demands as non-empty text.
    for check, key in ((7, "name"), (8, "address"), (10, "category")):
        if text_or_none(place.get(key)) is None:
            violations.append(
                Violation(
                    check,
                    f"{path}.{key} must be a non-empty string, got {describe(place.get(key))}",
                )
            )

    # Also check 10, but the loader wants more than text here — see `naver_url_or_none`.
    if naver_url_or_none(place.get("naverUrl")) is None:
        violations.append(
            Violation(
                10,
                f"{path}.naverUrl must be an https URL on "
                f"{' or '.join(NAVER_URL_HOSTS)}, got {describe(place.get('naverUrl'))}",
            )
        )

    # Check 9 — the approval gate. Joined on `display_name` because `review_candidates.csv` has no
    # id column and the canonical ID map does not exist yet; see `docs/architecture.md`. Both sides
    # are keyed on NFC (`normalize_name` — `load_approvals` does the same), so a decomposed name in
    # either file joins the row it names. The messages quote the *file's* spelling, not the key:
    # the operator has to find that string to fix it.
    original = text_or_none(place.get("name"))
    name = normalize_name(place.get("name"))
    if name is not None:
        if name in duplicates:
            violations.append(
                Violation(9,
                          f'{path}.name "{original}" matches more than one review row — ambiguous')
            )
        elif name not in approvals:
            violations.append(
                Violation(9, f'{path}.name "{original}" has no row in the review queue')
            )
        elif approvals[name] != "approved":
            violations.append(
                Violation(9, f'{path}.name "{original}" is "{approvals[name]}", not "approved"')
            )

    return violations


def _validate_transaction(
    transaction: dict[str, Any],
    path: str,
    window_start: date | None,
    window_end: date | None,
) -> list[Violation]:
    violations: list[Violation] = []

    # Check 4 — amount. Never influences ranking, but a negative one means the extraction misread
    # a refund line as a visit.
    raw_amount = transaction.get("amount")
    amount = as_number(raw_amount)
    if amount is None or amount < 0:
        violations.append(
            Violation(4, f"{path}.amount must be a number >= 0, got {describe(raw_amount)}")
        )

    # Check 5 — ISO date. `src/stats/` throws on a malformed date rather than dropping the row,
    # so one bad value here surfaces as an exception mid-render on the live site.
    raw_date = transaction.get("date")
    parsed = parse_iso_date(raw_date)
    if parsed is None:
        violations.append(
            Violation(5, f"{path}.date is not a real calendar date: {describe(raw_date)}")
        )
        return violations

    # Check 6 — inside the rolling window. Skipped when `updatedAt` gave no anchor; that failure
    # is already reported once at the dataset level.
    if window_start is None or window_end is None:
        return violations
    if not window_start <= parsed <= window_end:
        violations.append(
            Violation(
                6,
                f"{path}.date {raw_date} is outside the "
                f"{ROLLING_WINDOW_MONTHS}-month window {window_start}..{window_end}",
            )
        )
    return violations


def count_transactions(dataset: dict[str, Any]) -> int:
    total = 0
    for place in dataset.get("places", []):
        if isinstance(place, dict) and isinstance(place.get("transactions"), list):
            total += len(place["transactions"])
    return total


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python3 -m collector.validate",
        description="Run the nine PRD §32 checks over a built places.json. Non-zero exit = do not publish.",
    )
    parser.add_argument("dataset", type=Path, help="path to the built data/places.json")
    parser.add_argument(
        "--candidates",
        type=Path,
        default=DEFAULT_CANDIDATES,
        help=f"review queue CSV to join approvals from (default: {DEFAULT_CANDIDATES})",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    try:
        dataset = load_dataset(args.dataset)
        approvals, duplicates = load_approvals(args.candidates)
    except DatasetUnusable as error:
        print(f"validator could not run: {error}", file=sys.stderr)
        return EXIT_UNUSABLE

    violations = validate(dataset, approvals, duplicates)
    if violations:
        for violation in violations:
            print(violation.render(), file=sys.stderr)
        print(f"{len(violations)} violation(s) — do not publish", file=sys.stderr)
        return EXIT_INVALID

    places = dataset.get("places", [])
    updated_at = date.fromisoformat(dataset["updatedAt"])
    window_start = window_floor(updated_at)
    print(
        f"OK: {len(places)} places, {count_transactions(dataset)} transactions, "
        f"window {window_start}..{updated_at}"
    )
    return EXIT_OK


if __name__ == "__main__":
    raise SystemExit(main())
