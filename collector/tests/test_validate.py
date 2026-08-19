"""One failing case per PRD §32 check, plus the clean-dataset pass and the CLI exit codes.

The point of these tests is the *negative* direction: a check that silently passes bad data is the
only failure mode that matters here, so every test seeds a dataset that violates exactly one check
and asserts that check — and no other — is reported. Fixtures are built in ``tmp_path``; nothing
here reads or writes ``data/`` or the real ``review_candidates.csv``.
"""

from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Any

import pytest

from collector.validate import (
    EXIT_INVALID,
    EXIT_OK,
    EXIT_UNUSABLE,
    ROLLING_WINDOW_MONTHS,
    load_approvals,
    main,
    validate,
    window_floor,
)

from datetime import date

UPDATED_AT = "2026-08-01"


def place(**overrides: Any) -> dict[str, Any]:
    """A place that violates nothing. Each test overrides exactly one field."""
    base: dict[str, Any] = {
        "id": "restaurant_000001",
        "name": "신토불이교원대점",
        "category": "한식",
        "address": "충청북도 청주시 흥덕구 강내면 태성탑연로 399",
        "lat": 36.6188431,
        "lng": 127.3564631,
        "naverUrl": "https://map.naver.com/p/entry/place/1",
        "transactions": [{"date": "2026-07-18", "amount": 230000}],
    }
    base.update(overrides)
    return base


def dataset(*places: dict[str, Any], updated_at: str = UPDATED_AT) -> dict[str, Any]:
    return {"updatedAt": updated_at, "places": list(places or (place(),))}


def approvals(*names: str) -> dict[str, str]:
    return {name: "approved" for name in (names or ("신토불이교원대점",))}


def checks_reported(violations: list[Any]) -> set[int | None]:
    return {violation.check for violation in violations}


def details(violations: list[Any]) -> str:
    return "\n".join(violation.render() for violation in violations)


def test_clean_dataset_reports_nothing() -> None:
    assert validate(dataset(), approvals()) == []


# --- check 1: unique id ---------------------------------------------------------------------


def test_duplicate_id_is_reported() -> None:
    violations = validate(
        dataset(place(), place(name="까망염소")),
        approvals("신토불이교원대점", "까망염소"),
    )
    assert checks_reported(violations) == {1}
    assert "duplicate" in details(violations)


def test_id_differing_only_by_whitespace_is_still_a_duplicate() -> None:
    """The loader trims before storing, so the padded id is the same id downstream."""
    violations = validate(
        dataset(place(), place(id="restaurant_000001 ", name="까망염소")),
        approvals("신토불이교원대점", "까망염소"),
    )
    assert checks_reported(violations) == {1}


def test_blank_id_is_reported() -> None:
    violations = validate(dataset(place(id="   ")), approvals())
    assert checks_reported(violations) == {1}


# --- check 2: coordinates present -----------------------------------------------------------


@pytest.mark.parametrize("bad", [None, "36.6", True], ids=["null", "string", "bool"])
def test_missing_or_non_numeric_coordinate_is_reported(bad: Any) -> None:
    violations = validate(dataset(place(lat=bad)), approvals())
    assert checks_reported(violations) == {2}


def test_absent_coordinate_key_is_reported() -> None:
    without_lng = place()
    del without_lng["lng"]
    violations = validate(dataset(without_lng), approvals())
    assert checks_reported(violations) == {2}


# --- check 3: coordinates in range ----------------------------------------------------------


def test_coordinate_outside_korea_is_reported() -> None:
    """Tokyo — a plausible-looking geocoding mis-hit the loader's global range would wave through."""
    violations = validate(dataset(place(lat=35.6762, lng=139.6503)), approvals())
    assert checks_reported(violations) == {3}
    assert "lng" in details(violations)


def test_coordinate_on_the_boundary_passes() -> None:
    assert validate(dataset(place(lat=33.0, lng=124.0)), approvals()) == []


# --- check 4: amount >= 0 -------------------------------------------------------------------


@pytest.mark.parametrize("bad", [-1, "230000", None], ids=["negative", "string", "null"])
def test_bad_amount_is_reported(bad: Any) -> None:
    violations = validate(
        dataset(place(transactions=[{"date": "2026-07-18", "amount": bad}])), approvals()
    )
    assert checks_reported(violations) == {4}


def test_zero_amount_passes() -> None:
    assert validate(
        dataset(place(transactions=[{"date": "2026-07-18", "amount": 0}])), approvals()
    ) == []


# --- check 5: ISO date ----------------------------------------------------------------------


@pytest.mark.parametrize(
    "bad",
    ["2026-13-01", "2026-02-30", "2026-7-18", "20260718", "", None],
    ids=["month", "day", "unpadded", "compact", "empty", "null"],
)
def test_non_iso_transaction_date_is_reported(bad: Any) -> None:
    violations = validate(
        dataset(place(transactions=[{"date": bad, "amount": 1000}])), approvals()
    )
    assert checks_reported(violations) == {5}


# --- check 6: rolling window ----------------------------------------------------------------


def test_transaction_older_than_the_window_is_reported() -> None:
    violations = validate(
        dataset(place(transactions=[{"date": "2025-08-15", "amount": 1000}])), approvals()
    )
    assert checks_reported(violations) == {6}
    assert f"{ROLLING_WINDOW_MONTHS}-month window" in details(violations)


def test_transaction_after_updated_at_is_reported() -> None:
    violations = validate(
        dataset(place(transactions=[{"date": "2026-08-02", "amount": 1000}])), approvals()
    )
    assert checks_reported(violations) == {6}


def test_window_edges_pass() -> None:
    """Both ends inclusive: the first day of the oldest bucketed month, and `updatedAt` itself."""
    floor = window_floor(date.fromisoformat(UPDATED_AT))
    assert floor.isoformat() == "2025-09-01"
    assert validate(
        dataset(
            place(
                transactions=[
                    {"date": floor.isoformat(), "amount": 1000},
                    {"date": UPDATED_AT, "amount": 1000},
                ]
            )
        ),
        approvals(),
    ) == []


def test_day_anchored_boundary_is_rejected() -> None:
    """`updatedAt` minus 12 months is a month the app never buckets — the gate must not admit it.

    `src/stats/histogram.ts` renders the 12 calendar months ending with the anchor's own month, so
    for updatedAt 2026-08-01 anything in 2025-08 has no bar. Accepting it would let the bars sum to
    fewer visits than the 1년 count printed beside them.
    """
    violations = validate(
        dataset(place(transactions=[{"date": "2025-08-31", "amount": 1000}])), approvals()
    )
    assert checks_reported(violations) == {6}


def test_loader_parity_fields_are_reported() -> None:
    """`src/data/load.ts` rejects the whole file on these, so passing them here would ship a dead site."""
    for key in ("category", "naverUrl"):
        violations = validate(dataset(place(**{key: ""})), approvals())
        assert checks_reported(violations) == {10}, key


def test_nan_and_infinity_are_not_valid_json(tmp_path: Path, approved_csv: Path) -> None:
    """Python's json accepts them; RFC 8259 and the browser's `Response.json()` do not."""
    for literal in ("NaN", "Infinity", "-Infinity"):
        json_path = tmp_path / "places.json"
        json_path.write_text(
            '{"updatedAt":"2026-08-01","places":[],"stray":' + literal + "}", encoding="utf-8"
        )
        assert main([str(json_path), "--candidates", str(approved_csv)]) == EXIT_UNUSABLE, literal


def test_integer_beyond_float_range_is_reported_not_raised() -> None:
    """`math.isfinite` converts before testing, so a huge JSON integer raises instead of answering."""
    huge = 10**400
    assert checks_reported(validate(dataset(place(lat=huge)), approvals())) == {2}
    assert checks_reported(
        validate(dataset(place(transactions=[{"date": "2026-07-18", "amount": huge}])), approvals())
    ) == {4}


def test_bad_updated_at_is_reported_once_and_does_not_suppress_other_checks() -> None:
    violations = validate(dataset(place(address="  "), updated_at="not-a-date"), approvals())
    assert checks_reported(violations) == {6, 8}
    assert sum(1 for violation in violations if violation.check == 6) == 1


# --- checks 7 and 8: name and address -------------------------------------------------------


@pytest.mark.parametrize("bad", ["", "   ", None, 42], ids=["empty", "blank", "null", "number"])
def test_bad_name_is_reported(bad: Any) -> None:
    violations = validate(dataset(place(name=bad)), approvals())
    # Check 9 joins on the name, so an unusable name leaves it with no key and it is skipped —
    # check 7 already blocks publication, and a "no review row" line would name the wrong defect.
    assert checks_reported(violations) == {7}


@pytest.mark.parametrize("bad", ["", "   ", None], ids=["empty", "blank", "null"])
def test_bad_address_is_reported(bad: Any) -> None:
    violations = validate(dataset(place(address=bad)), approvals())
    assert checks_reported(violations) == {8}


# --- check 9: review status -----------------------------------------------------------------


@pytest.mark.parametrize("status", ["rejected", "pending", ""])
def test_place_not_approved_is_reported(status: str) -> None:
    violations = validate(dataset(), {"신토불이교원대점": status})
    assert checks_reported(violations) == {9}
    assert "approved" in details(violations)


def test_place_with_no_review_row_is_reported() -> None:
    """Golden Principle 2: a published place with no approval record is unapproved."""
    violations = validate(dataset(), {})
    assert checks_reported(violations) == {9}
    assert "no row in the review queue" in details(violations)


def test_ambiguous_review_row_is_reported() -> None:
    violations = validate(dataset(), approvals(), duplicate_names={"신토불이교원대점"})
    assert checks_reported(violations) == {9}
    assert "ambiguous" in details(violations)


# --- structural damage ----------------------------------------------------------------------


def test_places_not_an_array_is_reported_not_raised() -> None:
    violations = validate({"updatedAt": UPDATED_AT, "places": {}}, approvals())
    assert checks_reported(violations) == {None}


def test_place_that_is_not_an_object_names_its_index() -> None:
    violations = validate({"updatedAt": UPDATED_AT, "places": ["oops"]}, approvals())
    assert checks_reported(violations) == {None}
    assert "places[0]" in details(violations)


def test_transactions_not_an_array_is_reported_not_raised() -> None:
    violations = validate(dataset(place(transactions="none")), approvals())
    assert checks_reported(violations) == {None}


# --- the review queue reader ------------------------------------------------------------------


def write_candidates(path: Path, rows: list[dict[str, str]]) -> Path:
    columns = ["status", "canonical_name", "display_name"]
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)
    return path


def test_load_approvals_maps_name_to_status_and_flags_duplicates(tmp_path: Path) -> None:
    csv_path = write_candidates(
        tmp_path / "review_candidates.csv",
        [
            {"status": "approved", "canonical_name": "a", "display_name": "까망염소"},
            {"status": "rejected", "canonical_name": "b", "display_name": "다른곳"},
            {"status": "approved", "canonical_name": "c", "display_name": "까망염소"},
        ],
    )
    mapping, duplicates = load_approvals(csv_path)
    assert mapping["다른곳"] == "rejected"
    assert duplicates == {"까망염소"}


def test_load_approvals_rejects_a_csv_without_the_needed_columns(tmp_path: Path) -> None:
    csv_path = tmp_path / "review_candidates.csv"
    csv_path.write_text("foo,bar\n1,2\n", encoding="utf-8")
    with pytest.raises(Exception) as error:
        load_approvals(csv_path)
    assert "display_name" in str(error.value)


# --- CLI exit codes -------------------------------------------------------------------------


def write_dataset(path: Path, payload: Any) -> Path:
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return path


@pytest.fixture
def approved_csv(tmp_path: Path) -> Path:
    return write_candidates(
        tmp_path / "review_candidates.csv",
        [{"status": "approved", "canonical_name": "s", "display_name": "신토불이교원대점"}],
    )


def test_cli_exits_zero_on_a_clean_dataset(
    tmp_path: Path, approved_csv: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    json_path = write_dataset(tmp_path / "places.json", dataset())
    assert main([str(json_path), "--candidates", str(approved_csv)]) == EXIT_OK
    assert "OK: 1 places, 1 transactions" in capsys.readouterr().out


def test_cli_exits_one_and_lists_every_violation(
    tmp_path: Path, approved_csv: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    json_path = write_dataset(
        tmp_path / "places.json",
        dataset(place(address="", transactions=[{"date": "2026-07-18", "amount": -5}])),
    )
    assert main([str(json_path), "--candidates", str(approved_csv)]) == EXIT_INVALID
    err = capsys.readouterr().err
    assert "check 4 amount-non-negative" in err
    assert "check 8 address-present" in err
    assert "2 violation(s) — do not publish" in err


def test_cli_exits_two_when_the_dataset_is_missing(
    tmp_path: Path, approved_csv: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    missing = tmp_path / "places.json"
    assert main([str(missing), "--candidates", str(approved_csv)]) == EXIT_UNUSABLE
    assert "validator could not run" in capsys.readouterr().err


def test_cli_exits_two_when_the_dataset_is_not_json(
    tmp_path: Path, approved_csv: Path
) -> None:
    json_path = tmp_path / "places.json"
    json_path.write_text("{not json", encoding="utf-8")
    assert main([str(json_path), "--candidates", str(approved_csv)]) == EXIT_UNUSABLE


def test_cli_exits_two_when_the_root_is_not_an_object(
    tmp_path: Path, approved_csv: Path
) -> None:
    json_path = write_dataset(tmp_path / "places.json", [])
    assert main([str(json_path), "--candidates", str(approved_csv)]) == EXIT_UNUSABLE


def test_cli_exits_two_when_the_review_queue_is_missing(tmp_path: Path) -> None:
    json_path = write_dataset(tmp_path / "places.json", dataset())
    assert main([str(json_path), "--candidates", str(tmp_path / "nope.csv")]) == EXIT_UNUSABLE


def test_cli_exits_two_when_the_review_queue_is_not_utf8(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """Excel on a Korean Windows box writes CP949 — a decode failure is a broken run, not bad data.

    Guarded explicitly because ``UnicodeDecodeError`` is a ``ValueError``, so an ``OSError``-only
    handler lets it escape as a traceback and exit 1, the code that means "the data is bad".
    """
    json_path = write_dataset(tmp_path / "places.json", dataset())
    csv_path = tmp_path / "review_candidates.csv"
    csv_path.write_bytes("status,display_name\napproved,까망염소\n".encode("cp949"))
    assert main([str(json_path), "--candidates", str(csv_path)]) == EXIT_UNUSABLE
    assert "validator could not run" in capsys.readouterr().err


def test_cli_exits_two_when_the_dataset_is_not_utf8(tmp_path: Path, approved_csv: Path) -> None:
    json_path = tmp_path / "places.json"
    json_path.write_bytes(json.dumps(dataset(), ensure_ascii=False).encode("cp949"))
    assert main([str(json_path), "--candidates", str(approved_csv)]) == EXIT_UNUSABLE
