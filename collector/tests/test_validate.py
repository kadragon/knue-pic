"""One failing case per PRD §32 check, plus the clean-dataset pass and the CLI exit codes.

The point of these tests is the *negative* direction: a check that silently passes bad data is the
only failure mode that matters here, so every test seeds a dataset that violates exactly one check
and asserts that check — and no other — is reported. Fixtures are built in ``tmp_path``; nothing
here reads or writes ``data/`` or the real ``review_candidates.csv``.
"""

from __future__ import annotations

import csv
import json
import unicodedata
from pathlib import Path
from typing import Any

import pytest

from collector.validate import (
    EXIT_INVALID,
    EXIT_OK,
    EXIT_UNUSABLE,
    ROLLING_WINDOW_MONTHS,
    DatasetUnusable,
    load_approvals,
    load_id_map,
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
        "kind": "restaurant",
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


DEFAULT_NAME = "신토불이교원대점"


def approvals(*names: str) -> dict[str, str]:
    """``canonical_name`` -> ``approved`` — the shape ``load_approvals`` returns."""
    return {name: "approved" for name in (names or (DEFAULT_NAME,))}


def ids_from(data: dict[str, Any]) -> dict[str, str]:
    """``id`` -> canonical name, filing every place in ``data`` under its own name.

    Check 9 joins through ``collector/id_map.json``, so a dataset alone no longer says who approved
    a place. The default the whole suite uses is the *unrenamed* case — the place is filed under
    the name it publishes — which keeps each test seeding exactly one defect. A place whose ``name``
    is itself the defect under test falls back to ``DEFAULT_NAME`` so its check 9 stays silent.
    The rename tests pass their own map instead.
    """
    places = data.get("places")
    mapping: dict[str, str] = {}
    for item in places if isinstance(places, list) else ():
        if not isinstance(item, dict):
            continue
        place_id = item.get("id")
        if not isinstance(place_id, str) or not place_id.strip():
            continue
        name = item.get("name")
        canonical = unicodedata.normalize("NFC", name.strip()) if isinstance(name, str) \
            and name.strip() else DEFAULT_NAME
        mapping.setdefault(place_id.strip(), canonical)
    return mapping


def check(
    data: dict[str, Any],
    approved: dict[str, str],
    duplicate_names: Any = (),
    id_names: dict[str, str] | None = None,
) -> list[Any]:
    """``validate`` with the ID map defaulted to ``ids_from(data)``."""
    return validate(
        data, approved, ids_from(data) if id_names is None else id_names, duplicate_names
    )


def checks_reported(violations: list[Any]) -> set[int | None]:
    return {violation.check for violation in violations}


def details(violations: list[Any]) -> str:
    return "\n".join(violation.render() for violation in violations)


def test_clean_dataset_reports_nothing() -> None:
    assert check(dataset(), approvals()) == []


# --- check 1: unique id ---------------------------------------------------------------------


def test_duplicate_id_is_reported() -> None:
    violations = check(
        dataset(place(), place(name="까망염소")),
        approvals("신토불이교원대점", "까망염소"),
    )
    assert checks_reported(violations) == {1}
    assert "duplicate" in details(violations)


def test_id_differing_only_by_whitespace_is_still_a_duplicate() -> None:
    """The loader trims before storing, so the padded id is the same id downstream."""
    violations = check(
        dataset(place(), place(id="restaurant_000001 ", name="까망염소")),
        approvals("신토불이교원대점", "까망염소"),
    )
    assert checks_reported(violations) == {1}


def test_blank_id_is_reported() -> None:
    violations = check(dataset(place(id="   ")), approvals())
    assert checks_reported(violations) == {1}


# --- check 2: coordinates present -----------------------------------------------------------


@pytest.mark.parametrize("bad", [None, "36.6", True], ids=["null", "string", "bool"])
def test_missing_or_non_numeric_coordinate_is_reported(bad: Any) -> None:
    violations = check(dataset(place(lat=bad)), approvals())
    assert checks_reported(violations) == {2}


def test_absent_coordinate_key_is_reported() -> None:
    without_lng = place()
    del without_lng["lng"]
    violations = check(dataset(without_lng), approvals())
    assert checks_reported(violations) == {2}


# --- check 3: coordinates in range ----------------------------------------------------------


def test_coordinate_outside_korea_is_reported() -> None:
    """Tokyo — a plausible-looking geocoding mis-hit the loader's global range would wave through."""
    violations = check(dataset(place(lat=35.6762, lng=139.6503)), approvals())
    assert checks_reported(violations) == {3}
    assert "lng" in details(violations)


def test_coordinate_on_the_boundary_passes() -> None:
    assert check(dataset(place(lat=33.0, lng=124.0)), approvals()) == []


# --- check 4: amount >= 0 -------------------------------------------------------------------


@pytest.mark.parametrize("bad", [-1, "230000", None], ids=["negative", "string", "null"])
def test_bad_amount_is_reported(bad: Any) -> None:
    violations = check(
        dataset(place(transactions=[{"date": "2026-07-18", "amount": bad}])), approvals()
    )
    assert checks_reported(violations) == {4}


def test_zero_amount_passes() -> None:
    assert check(
        dataset(place(transactions=[{"date": "2026-07-18", "amount": 0}])), approvals()
    ) == []


# --- check 5: ISO date ----------------------------------------------------------------------


@pytest.mark.parametrize(
    "bad",
    ["2026-13-01", "2026-02-30", "2026-7-18", "20260718", "", None],
    ids=["month", "day", "unpadded", "compact", "empty", "null"],
)
def test_non_iso_transaction_date_is_reported(bad: Any) -> None:
    violations = check(
        dataset(place(transactions=[{"date": bad, "amount": 1000}])), approvals()
    )
    assert checks_reported(violations) == {5}


# --- check 6: rolling window ----------------------------------------------------------------


def test_transaction_older_than_the_window_is_reported() -> None:
    violations = check(
        dataset(place(transactions=[{"date": "2025-05-15", "amount": 1000}])), approvals()
    )
    assert checks_reported(violations) == {6}
    assert f"{ROLLING_WINDOW_MONTHS}-month window" in details(violations)


def test_transaction_after_updated_at_is_reported() -> None:
    violations = check(
        dataset(place(transactions=[{"date": "2026-08-02", "amount": 1000}])), approvals()
    )
    assert checks_reported(violations) == {6}


def test_window_edges_pass() -> None:
    """Both ends inclusive: the first day of the oldest bucketed month, and `updatedAt` itself."""
    floor = window_floor(date.fromisoformat(UPDATED_AT))
    assert floor.isoformat() == "2025-06-01"
    assert check(
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
    """The floor is a whole month, not ``updatedAt`` minus 15 months to the day.

    For updatedAt 2026-08-01 a day-anchored floor would land on 2025-05-01 and admit the tail of a
    month the file otherwise stops short of. A half-collected month is worse than an absent one:
    every window that touches it reports a count nobody can reproduce from the disclosures.
    """
    violations = check(
        dataset(place(transactions=[{"date": "2025-05-31", "amount": 1000}])), approvals()
    )
    assert checks_reported(violations) == {6}


def test_the_month_a_year_back_is_inside_the_window() -> None:
    """What the widening from 12 months bought.

    The 작년 같은 달 column (`src/ui/place-columns.ts`) ranks the calendar month twelve months
    before the anchor's own. Under a 12-month window that month sat exactly on the floor and fell
    out of the published file on the next monthly run, leaving the column permanently empty.
    """
    assert (
        check(
            dataset(
                place(
                    transactions=[
                        {"date": "2025-08-01", "amount": 1000},
                        {"date": "2025-08-31", "amount": 1000},
                    ]
                )
            ),
            approvals(),
        )
        == []
    )


def test_loader_parity_fields_are_reported() -> None:
    """`src/data/load.ts` rejects the whole file on these, so passing them here would ship a dead site."""
    for key in ("category", "naverUrl"):
        violations = check(dataset(place(**{key: ""})), approvals())
        assert checks_reported(violations) == {10}, key


@pytest.mark.parametrize("kind", ["", None, "restaurants", "식당", "RESTAURANT"])
def test_a_kind_outside_the_published_set_is_reported(kind: Any) -> None:
    """`parsePlace` in `src/data/load.ts` rejects the whole file over a kind it does not know, so a
    gate checking only that the field is non-empty would certify a dataset that blanks the site.
    A plausible near-miss — a bucket added to the collector and not to the loader — is exactly what
    non-emptiness waves through."""
    violations = check(dataset(place(kind=kind)), approvals())
    assert checks_reported(violations) == {10}, kind


def test_a_place_with_no_kind_at_all_is_reported() -> None:
    """The field is absent rather than wrong — a dataset built before `kind` existed."""
    without = place()
    del without["kind"]
    assert checks_reported(check(dataset(without), approvals())) == {10}


def test_naver_url_scheme_and_host_are_reported() -> None:
    """`requireNaverUrl` in `src/data/load.ts` rejects these, so a gate that accepts them is weaker
    than the loader it guards — the dataset would validate and then blank the site."""
    for url in (
        "javascript:alert(1)",
        "http://map.naver.com/p/entry/place/1",
        # Ends with `naver.com` without being a subdomain of it.
        "https://evilnaver.com/p/entry/place/1",
        "https://example.com/p/entry/place/1",
        "한밭식당",
        # WHATWG reads the backslash as an authority separator, so the loader sees host
        # `evil.com`. `urlsplit` alone would read userinfo `evil.com\\` on host `naver.com`
        # and pass it — a gate weaker than the loader publishes a dataset that blanks the site.
        "https://evil.com\\@naver.com/x",
        # `new URL` rejects a port outside 0..65535, so the loader rejects the whole file;
        # `urlsplit` only range-checks the port when the attribute is read.
        "https://naver.com:99999/x",
        "https://naver.com:-1/x",
        # No stdlib parser reproduces WHATWG IDNA — Python's `idna` codec accepts `xn--b0b`,
        # which `new URL` rejects. The gate refuses every `xn--` label rather than mirror it,
        # which also refuses `xn--h32b` that the loader would accept: stricter, never looser.
        "https://xn--a.naver.com/x",
        "https://xn--b0b.naver.com/x",
        "https://xn--h32b.naver.com/x",
        # `urlsplit` itself raises on a malformed IPv6 authority. The validator must report a
        # violation, never abort the run with a traceback.
        "https://[::1/x",
    ):
        violations = check(dataset(place(naverUrl=url)), approvals())
        assert checks_reported(violations) == {10}, url


def test_naver_url_accepts_the_hosts_the_loader_accepts() -> None:
    for url in (
        "https://map.naver.com/p/entry/place/1",
        "https://naver.me/xAbCdEf",
        "https://m.map.naver.com/p/entry/place/1",
        # The mirror of the rejected backslash case: here both parsers read host `naver.com`
        # and the rest as path, so the gate must not reject what the loader accepts either.
        "https://naver.com\\@evil.com/x",
        "https://naver.com:443/p/entry/place/1",
    ):
        assert check(dataset(place(naverUrl=url)), approvals()) == [], url


def test_nan_and_infinity_are_not_valid_json(
    tmp_path: Path, approved_csv: Path, approved_id_map: Path
) -> None:
    """Python's json accepts them; RFC 8259 and the browser's `Response.json()` do not."""
    for literal in ("NaN", "Infinity", "-Infinity"):
        json_path = tmp_path / "places.json"
        json_path.write_text(
            '{"updatedAt":"2026-08-01","places":[],"stray":' + literal + "}", encoding="utf-8"
        )
        assert main([str(json_path), "--candidates", str(approved_csv),
                 "--id-map", str(approved_id_map)]) == EXIT_UNUSABLE, literal


def test_integer_beyond_float_range_is_reported_not_raised() -> None:
    """`math.isfinite` converts before testing, so a huge JSON integer raises instead of answering."""
    huge = 10**400
    assert checks_reported(check(dataset(place(lat=huge)), approvals())) == {2}
    assert checks_reported(
        check(dataset(place(transactions=[{"date": "2026-07-18", "amount": huge}])), approvals())
    ) == {4}


def test_bad_updated_at_is_reported_once_and_does_not_suppress_other_checks() -> None:
    violations = check(dataset(place(address="  "), updated_at="not-a-date"), approvals())
    assert checks_reported(violations) == {6, 8}
    assert sum(1 for violation in violations if violation.check == 6) == 1


# --- checks 7 and 8: name and address -------------------------------------------------------


@pytest.mark.parametrize("bad", ["", "   ", None, 42], ids=["empty", "blank", "null", "number"])
def test_bad_name_is_reported(bad: Any) -> None:
    violations = check(dataset(place(name=bad)), approvals())
    # Check 9 joins on the name, so an unusable name leaves it with no key and it is skipped —
    # check 7 already blocks publication, and a "no review row" line would name the wrong defect.
    assert checks_reported(violations) == {7}


@pytest.mark.parametrize("bad", ["", "   ", None], ids=["empty", "blank", "null"])
def test_bad_address_is_reported(bad: Any) -> None:
    violations = check(dataset(place(address=bad)), approvals())
    assert checks_reported(violations) == {8}


# --- check 9: review status -----------------------------------------------------------------


@pytest.mark.parametrize("status", ["rejected", "pending", ""])
def test_place_not_approved_is_reported(status: str) -> None:
    violations = check(dataset(), {"신토불이교원대점": status})
    assert checks_reported(violations) == {9}
    assert "approved" in details(violations)


def test_place_with_no_review_row_is_reported() -> None:
    """Golden Principle 2: a published place with no approval record is unapproved."""
    violations = check(dataset(), {})
    assert checks_reported(violations) == {9}
    assert "no row in the review queue" in details(violations)


def test_ambiguous_review_row_is_reported() -> None:
    violations = check(dataset(), approvals(), duplicate_names={"신토불이교원대점"})
    assert checks_reported(violations) == {9}
    assert "ambiguous" in details(violations)


# The join runs `place.id` -> `collector/id_map.json` -> `review_candidates.csv`, never through
# `name`. These four fix that: the first is the defect the change exists to remove, the rest are
# the directions it still has to fail closed in.


def test_a_renamed_business_keeps_its_approval() -> None:
    """The point of the ID join: the queue is retyped, the approval survives.

    Under the old `display_name` join this was check 9 "no row in the review queue" — the gate
    blocking a deploy for a place a human had approved, because a business changed its sign.
    """
    renamed = dataset(place(name="신토불이 교원대점 (본점)"))
    assert check(renamed, approvals(),
                 id_names={"restaurant_000001": DEFAULT_NAME}) == []


def test_a_place_whose_id_is_in_no_id_map_entry_is_reported() -> None:
    """No canonical name means no answer to "was this approved?" — and that is not a pass."""
    violations = check(dataset(), approvals(), id_names={})
    assert checks_reported(violations) == {9}
    assert "collector/id_map.json" in details(violations)


def test_a_renamed_place_filed_under_an_unapproved_name_is_still_reported() -> None:
    """The rename cannot launder a rejection either — the id still names the rejected row."""
    violations = check(dataset(place(name="새 이름")), {"까망염소": "rejected"},
                       id_names={"restaurant_000001": "까망염소"})
    assert checks_reported(violations) == {9}
    assert '"rejected", not "approved"' in details(violations)


def test_the_published_name_alone_can_no_longer_approve_a_place() -> None:
    """A name matching an approved row is worth nothing when the id is filed elsewhere.

    The old join read exactly this dataset as approved: rename a rejected row's `display_name` to
    an approved place's name and the approval followed the string.
    """
    violations = check(dataset(), approvals(DEFAULT_NAME),
                       id_names={"restaurant_000001": "다른집"})
    assert checks_reported(violations) == {9}
    assert "no row in the review queue" in details(violations)


# --- structural damage ----------------------------------------------------------------------


def test_places_not_an_array_is_reported_not_raised() -> None:
    violations = check({"updatedAt": UPDATED_AT, "places": {}}, approvals())
    assert checks_reported(violations) == {None}


def test_place_that_is_not_an_object_names_its_index() -> None:
    violations = check({"updatedAt": UPDATED_AT, "places": ["oops"]}, approvals())
    assert checks_reported(violations) == {None}
    assert "places[0]" in details(violations)


def test_transactions_not_an_array_is_reported_not_raised() -> None:
    violations = check(dataset(place(transactions="none")), approvals())
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
            {"status": "approved", "canonical_name": "까망염소", "display_name": "까망염소"},
            {"status": "rejected", "canonical_name": "다른곳", "display_name": "다른 곳"},
            {"status": "approved", "canonical_name": "까망염소", "display_name": "까망염소 2호"},
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
    assert "canonical_name" in str(error.value)


# --- the canonical ID map reader ---------------------------------------------------------------


def test_load_id_map_reverses_the_file(tmp_path: Path) -> None:
    """The file stores name -> id; check 9 holds an id and needs the name."""
    path = write_id_map(tmp_path / "id_map.json",
                        {DEFAULT_NAME: "restaurant_000001", "까망염소": "restaurant_000002"})
    assert load_id_map(path) == {
        "restaurant_000001": DEFAULT_NAME,
        "restaurant_000002": "까망염소",
    }


def test_load_id_map_keys_a_decomposed_name_in_nfc(tmp_path: Path) -> None:
    path = write_id_map(tmp_path / "id_map.json", {NFD_NAME: "restaurant_000001"})
    assert load_id_map(path) == {"restaurant_000001": DEFAULT_NAME}


def test_load_id_map_accepts_two_spellings_of_one_name_on_one_id(tmp_path: Path) -> None:
    """The same entry written twice, not a conflict — that is what normalizing the key means."""
    path = write_id_map(tmp_path / "id_map.json",
                        {DEFAULT_NAME: "restaurant_000001", NFD_NAME: "restaurant_000001"})
    assert load_id_map(path) == {"restaurant_000001": DEFAULT_NAME}


def test_load_id_map_refuses_one_id_naming_two_businesses(tmp_path: Path) -> None:
    path = write_id_map(tmp_path / "id_map.json",
                        {DEFAULT_NAME: "restaurant_000001", "까망염소": "restaurant_000001"})
    with pytest.raises(DatasetUnusable) as error:
        load_id_map(path)
    assert "two businesses" in str(error.value)


def test_load_id_map_refuses_a_missing_file(tmp_path: Path) -> None:
    """A first *build* has no map; a gate run with places and no map decides nothing."""
    with pytest.raises(DatasetUnusable):
        load_id_map(tmp_path / "nope.json")


@pytest.mark.parametrize("payload", ["[]", '{"a": 1}', '{"a": ""}', "{not json"],
                         ids=["array", "non-string-id", "empty-id", "not-json"])
def test_load_id_map_refuses_an_unusable_payload(tmp_path: Path, payload: str) -> None:
    path = tmp_path / "id_map.json"
    path.write_text(payload, encoding="utf-8")
    with pytest.raises(DatasetUnusable):
        load_id_map(path)


def test_cli_exits_two_when_the_id_map_is_missing(
    tmp_path: Path, approved_csv: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    json_path = write_dataset(tmp_path / "places.json", dataset())
    assert main([str(json_path), "--candidates", str(approved_csv),
                 "--id-map", str(tmp_path / "nope.json")]) == EXIT_UNUSABLE
    assert "validator could not run" in capsys.readouterr().err


# --- CLI exit codes -------------------------------------------------------------------------


def write_dataset(path: Path, payload: Any) -> Path:
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return path


def write_id_map(path: Path, mapping: dict[str, str]) -> Path:
    """The forward map ``build_places.py`` writes: ``canonical_name`` -> ``id``."""
    path.write_text(json.dumps(mapping, ensure_ascii=False), encoding="utf-8")
    return path


@pytest.fixture
def approved_id_map(tmp_path: Path) -> Path:
    return write_id_map(tmp_path / "id_map.json", {DEFAULT_NAME: "restaurant_000001"})


@pytest.fixture
def approved_csv(tmp_path: Path) -> Path:
    return write_candidates(
        tmp_path / "review_candidates.csv",
        [{"status": "approved", "canonical_name": DEFAULT_NAME, "display_name": DEFAULT_NAME}],
    )


def test_cli_exits_zero_on_a_clean_dataset(
    tmp_path: Path, approved_csv: Path, approved_id_map: Path,
    capsys: pytest.CaptureFixture[str]
) -> None:
    json_path = write_dataset(tmp_path / "places.json", dataset())
    assert main([str(json_path), "--candidates", str(approved_csv),
                 "--id-map", str(approved_id_map)]) == EXIT_OK
    assert "OK: 1 places, 1 transactions" in capsys.readouterr().out


def test_cli_exits_one_and_lists_every_violation(
    tmp_path: Path, approved_csv: Path, approved_id_map: Path,
    capsys: pytest.CaptureFixture[str]
) -> None:
    json_path = write_dataset(
        tmp_path / "places.json",
        dataset(place(address="", transactions=[{"date": "2026-07-18", "amount": -5}])),
    )
    assert main([str(json_path), "--candidates", str(approved_csv),
                 "--id-map", str(approved_id_map)]) == EXIT_INVALID
    err = capsys.readouterr().err
    assert "check 4 amount-non-negative" in err
    assert "check 8 address-present" in err
    assert "2 violation(s) — do not publish" in err


def test_cli_exits_two_when_the_dataset_is_missing(
    tmp_path: Path, approved_csv: Path, approved_id_map: Path,
    capsys: pytest.CaptureFixture[str]
) -> None:
    missing = tmp_path / "places.json"
    assert main([str(missing), "--candidates", str(approved_csv),
                 "--id-map", str(approved_id_map)]) == EXIT_UNUSABLE
    assert "validator could not run" in capsys.readouterr().err


def test_cli_exits_two_when_the_dataset_is_not_json(
    tmp_path: Path, approved_csv: Path, approved_id_map: Path
) -> None:
    json_path = tmp_path / "places.json"
    json_path.write_text("{not json", encoding="utf-8")
    assert main([str(json_path), "--candidates", str(approved_csv),
                 "--id-map", str(approved_id_map)]) == EXIT_UNUSABLE


def test_cli_exits_two_when_the_root_is_not_an_object(
    tmp_path: Path, approved_csv: Path, approved_id_map: Path
) -> None:
    json_path = write_dataset(tmp_path / "places.json", [])
    assert main([str(json_path), "--candidates", str(approved_csv),
                 "--id-map", str(approved_id_map)]) == EXIT_UNUSABLE


def test_cli_exits_two_when_the_review_queue_is_missing(tmp_path: Path) -> None:
    json_path = write_dataset(tmp_path / "places.json", dataset())
    assert main([str(json_path), "--candidates", str(tmp_path / "nope.csv"),
                 "--id-map", str(tmp_path / "id_map.json")]) == EXIT_UNUSABLE


def test_cli_exits_two_when_the_review_queue_is_not_utf8(
    tmp_path: Path, approved_id_map: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """Excel on a Korean Windows box writes CP949 — a decode failure is a broken run, not bad data.

    Guarded explicitly because ``UnicodeDecodeError`` is a ``ValueError``, so an ``OSError``-only
    handler lets it escape as a traceback and exit 1, the code that means "the data is bad".
    """
    json_path = write_dataset(tmp_path / "places.json", dataset())
    csv_path = tmp_path / "review_candidates.csv"
    csv_path.write_bytes("status,canonical_name\napproved,까망염소\n".encode("cp949"))
    assert main([str(json_path), "--candidates", str(csv_path),
                 "--id-map", str(approved_id_map)]) == EXIT_UNUSABLE
    assert "validator could not run" in capsys.readouterr().err


def test_cli_exits_two_when_the_dataset_is_not_utf8(
    tmp_path: Path, approved_csv: Path, approved_id_map: Path
) -> None:
    json_path = tmp_path / "places.json"
    json_path.write_bytes(json.dumps(dataset(), ensure_ascii=False).encode("cp949"))
    assert main([str(json_path), "--candidates", str(approved_csv),
                 "--id-map", str(approved_id_map)]) == EXIT_UNUSABLE


# --- Unicode normalization ---------------------------------------------------------------------

# `review_candidates.csv` and `collector/id_map.json` are both edited by hand; a macOS paste
# carries the decomposed spelling of a Korean name and Naver's API the composed one. Check 9 joins
# the queue's `canonical_name` to the ID map's key, so both sides are keyed on NFC or the gate reads
# one business as two. Check 11 keys the published `name` the same way.
NFD_NAME = unicodedata.normalize("NFD", "신토불이교원대점")


def test_a_decomposed_dataset_name_matches_a_composed_approval() -> None:
    assert check(dataset(place(name=NFD_NAME)), approvals()) == []


def test_load_approvals_keys_a_decomposed_name_in_nfc(tmp_path: Path) -> None:
    approved, duplicates = load_approvals(write_candidates(
        tmp_path / "review_candidates.csv",
        [{"status": "approved", "canonical_name": NFD_NAME, "display_name": NFD_NAME}],
    ))
    assert approved == {"신토불이교원대점": "approved"}
    assert duplicates == set()
    # End to end: a composed dataset name against that decomposed row passes the gate.
    assert check(dataset(), approved, duplicates) == []


def test_one_name_published_twice_in_the_two_forms_is_reported() -> None:
    """Check 1 sees two distinct ids; only check 11 sees one business published twice."""
    violations = check(
        dataset(place(), place(id="restaurant_000002", name=NFD_NAME)),
        approvals(),
    )

    assert checks_reported(violations) == {11}


def test_one_name_published_twice_verbatim_is_reported() -> None:
    violations = check(dataset(place(), place(id="restaurant_000002")), approvals())

    assert checks_reported(violations) == {11}


def test_two_different_names_are_not_reported_as_duplicates() -> None:
    violations = check(
        dataset(place(), place(id="restaurant_000002", name="만리장성")),
        approvals("신토불이교원대점", "만리장성"),
    )

    assert violations == []


def test_one_name_approved_in_both_forms_is_still_ambiguous(tmp_path: Path) -> None:
    """Normalizing the key must not resolve the ambiguity — it is what makes it visible."""
    approved, duplicates = load_approvals(write_candidates(
        tmp_path / "review_candidates.csv",
        [
            {"status": "approved", "canonical_name": DEFAULT_NAME, "display_name": DEFAULT_NAME},
            {"status": "rejected", "canonical_name": NFD_NAME, "display_name": "신토불이 교원대점"},
        ],
    ))
    assert duplicates == {"신토불이교원대점"}
    violations = check(dataset(), approved, duplicates)
    assert checks_reported(violations) == {9}
    assert "ambiguous" in details(violations)
