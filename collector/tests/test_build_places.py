"""What the build must never do, one test per way it could.

The interesting direction is the one that publishes something it should not: a pending row that
reaches the dataset, an ID handed to a second business, a transaction outside the window that the
1y view will then ignore. Each test seeds the smallest fixture that could produce that outcome and
asserts it does not. Fixtures live in ``tmp_path``; nothing here reads or writes ``data/``,
``collector/out/`` or the real ``review_candidates.csv``.

The last test is the end-to-end one: a built dataset is fed to ``collector.validate``, so the two
modules are checked against each other rather than each against its own idea of the contract.
"""

from __future__ import annotations

import csv
import json
import unicodedata
from datetime import date
from pathlib import Path
from typing import Any

import pytest

from collector.build_places import (
    EXIT_OK,
    EXIT_UNUSABLE,
    UNCLASSIFIED_CATEGORY,
    load_id_map,
    main,
    naver_search_url,
    next_index,
)
from collector.validate import naver_url_or_none, window_floor
from collector.validate import main as validate_main

UPDATED_AT = date(2026, 8, 1)
WINDOW_START = window_floor(UPDATED_AT)  # 2025-09-01

CSV_COLUMNS = [
    "status", "canonical_name", "display_name", "raw_names", "months", "visits",
    "naver_title", "category", "address", "road_address", "lat", "lng",
    "candidate_count", "region_ok", "category_ok", "query", "note",
]


def row(**overrides: Any) -> dict[str, Any]:
    """An approved review row that publishes cleanly. Each test overrides one field."""
    base = {column: "" for column in CSV_COLUMNS}
    base.update({
        "status": "approved",
        "canonical_name": "까망염소",
        "display_name": "까망염소",
        "category": "한식>육류,고기요리",
        "address": "충청북도 청주시 흥덕구 지동동 692-1",
        "road_address": "충청북도 청주시 흥덕구 고락로40번길 19",
        "lat": "36.6429826",
        "lng": "127.4010072",
    })
    base.update(overrides)
    return base


def write_csv(path: Path, rows: list[dict[str, Any]]) -> Path:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)
    return path


def write_month(
    out_dir: Path,
    month: str,
    places: list[dict[str, Any]],
    transactions: list[dict[str, Any]],
) -> None:
    directory = out_dir / month
    directory.mkdir(parents=True)
    (directory / "normalized_places.json").write_text(
        json.dumps({"month": month, "places": places}, ensure_ascii=False), encoding="utf-8")
    (directory / "raw_transactions.json").write_text(
        json.dumps({"month": month, "transactions": transactions}, ensure_ascii=False),
        encoding="utf-8")


def normalized(canonical: str = "까망염소", raw_names: list[str] | None = None) -> dict[str, Any]:
    return {"canonicalName": canonical, "displayName": canonical,
            "rawNames": raw_names if raw_names is not None else [canonical]}


def transaction(venue: str = "까망염소", when: str = "2026-07-13",
                amount: int = 230000) -> dict[str, Any]:
    return {"date": when, "amount": amount, "venue": venue}


class Fixture:
    """Paths for one build, so a test states only what it changes."""

    def __init__(self, tmp_path: Path) -> None:
        self.candidates = tmp_path / "review_candidates.csv"
        self.out_dir = tmp_path / "out"
        self.id_map = tmp_path / "id_map.json"
        self.output = tmp_path / "places.json"

    def run(self, updated_at: date = UPDATED_AT) -> int:
        return main([
            "--candidates", str(self.candidates),
            "--out-dir", str(self.out_dir),
            "--id-map", str(self.id_map),
            "--output", str(self.output),
            "--updated-at", updated_at.isoformat(),
        ])

    def dataset(self) -> dict[str, Any]:
        return json.loads(self.output.read_text(encoding="utf-8"))

    def places(self) -> list[dict[str, Any]]:
        return self.dataset()["places"]


@pytest.fixture()
def fixture(tmp_path: Path) -> Fixture:
    """One approved place with one in-window visit — the clean case every test starts from."""
    built = Fixture(tmp_path)
    write_csv(built.candidates, [row()])
    write_month(built.out_dir, "2026-07", [normalized()], [transaction()])
    return built


def test_clean_build_publishes_the_approved_place(fixture: Fixture) -> None:
    assert fixture.run() == EXIT_OK
    places = fixture.places()
    assert len(places) == 1
    assert places[0]["name"] == "까망염소"
    assert places[0]["category"] == "한식"  # first segment of the Naver taxonomy path
    assert places[0]["address"] == "충청북도 청주시 흥덕구 고락로40번길 19"  # road address wins
    assert places[0]["transactions"] == [{"date": "2026-07-13", "amount": 230000}]
    assert fixture.dataset()["updatedAt"] == "2026-08-01"


@pytest.mark.parametrize("status", ["pending", "rejected", "", "APPROVED", "approve"])
def test_only_exactly_approved_rows_publish(fixture: Fixture, status: str) -> None:
    """Golden Principle 2. Anything that is not the token publishes nothing — case included."""
    write_csv(fixture.candidates, [row(status=status)])
    assert fixture.run() == EXIT_OK
    assert fixture.places() == []


def test_surrounding_whitespace_on_the_status_is_ignored_as_the_gate_ignores_it(
        fixture: Fixture) -> None:
    """`load_approvals` in `collector/validate.py` strips the status before comparing it.

    Trimming here is not leniency, it is agreement: a build that dropped `"approved "` while
    check 9 read it as approved would silently omit a place a human did approve, and nothing
    would report the gap.
    """
    write_csv(fixture.candidates, [row(status=" approved ")])
    assert fixture.run() == EXIT_OK
    assert len(fixture.places()) == 1


def test_a_pending_row_does_not_ride_along_with_an_approved_one(fixture: Fixture) -> None:
    write_csv(fixture.candidates, [row(), row(status="pending", canonical_name="만리장성",
                                             display_name="만리장성")])
    write_month(fixture.out_dir, "2026-06",
                [normalized(), normalized("만리장성")],
                [transaction(), transaction("만리장성", "2026-06-10")])
    assert fixture.run() == EXIT_OK
    assert [place["name"] for place in fixture.places()] == ["까망염소"]


def test_duplicate_approved_canonical_name_stops_the_build(fixture: Fixture) -> None:
    """Two approved rows for one name have no defensible answer, so nothing is written."""
    write_csv(fixture.candidates, [row(), row(lat="0", lng="0")])
    assert fixture.run() == EXIT_UNUSABLE
    assert not fixture.output.exists()


def test_duplicate_approved_display_name_stops_the_build(fixture: Fixture) -> None:
    """`display_name` is the column check 9 joins on, so a repeat is the same ambiguity.

    Guarding only the canonical name let two rows with distinct canonical names and one display
    name build cleanly — two places sharing a `name`, two IDs already minted, and check 9 then
    reporting both as ambiguous. The refusal belongs here, one operator edit earlier.
    """
    write_csv(fixture.candidates, [
        row(canonical_name="까망염소", display_name="같은이름"),
        row(canonical_name="만리장성", display_name="같은이름"),
    ])
    assert fixture.run() == EXIT_UNUSABLE
    assert not fixture.output.exists()


@pytest.mark.parametrize("status", ["pending", "rejected"])
def test_an_approved_name_repeated_on_an_unapproved_row_stops_the_build(
        fixture: Fixture, status: str) -> None:
    """Check 9 counts *rows*, not approvals, so the build has to count them the same way.

    Comparing approved rows only let this pair build cleanly and mint an ID, and the gate then
    refused the dataset as ambiguous — the build and check 9 disagreeing about one name, one step
    later and one deploy more expensive.
    """
    write_csv(fixture.candidates, [
        row(),
        row(status=status, canonical_name="만리장성", display_name="까망염소"),
    ])
    assert fixture.run() == EXIT_UNUSABLE
    assert not fixture.output.exists()


def test_blank_display_name_on_an_approved_row_stops_the_build(fixture: Fixture) -> None:
    """Falling back to the canonical name would publish a place check 9 sees as unapproved."""
    write_csv(fixture.candidates, [row(display_name="")])
    assert fixture.run() == EXIT_UNUSABLE
    assert not fixture.output.exists()


@pytest.mark.parametrize("bad", ["", "nan", "inf", "-Infinity", "1e400"])
def test_unparseable_or_non_finite_coordinates_stop_the_build(fixture: Fixture, bad: str) -> None:
    """`float("nan")` does not raise; writing it would emit JSON no browser parser accepts."""
    write_csv(fixture.candidates, [row(lat=bad, lng=bad)])
    assert fixture.run() == EXIT_UNUSABLE
    assert not fixture.output.exists()


def test_an_out_dir_with_no_month_data_stops_the_build(tmp_path: Path) -> None:
    """The dangerous case is not "no places" — it is "no inputs", published as an empty map.

    `collector/out/` is gitignored, so a fresh clone or a mistyped `--out-dir` has no months in
    it. Building on regardless overwrote the dataset with `places: []` and exited 0, and nothing
    downstream reports the loss: the validator has no minimum-place check, so CI would mark the
    empty file validated and publish a map with nothing on it.
    """
    built = Fixture(tmp_path)
    write_csv(built.candidates, [row()])
    built.out_dir.mkdir()
    assert built.run() == EXIT_UNUSABLE
    assert not built.output.exists()


def test_missing_candidates_file_is_unusable(fixture: Fixture) -> None:
    fixture.candidates.unlink()
    assert fixture.run() == EXIT_UNUSABLE


def test_ids_are_stable_across_runs(fixture: Fixture) -> None:
    """A place already in the map keeps its ID, even as other places arrive before it."""
    assert fixture.run() == EXIT_OK
    first_id = fixture.places()[0]["id"]
    assert first_id == "restaurant_000001"

    # `가나다` sorts before `까망염소`, so a naive re-numbering would hand it 000001.
    write_csv(fixture.candidates, [row(), row(canonical_name="가나다", display_name="가나다")])
    write_month(fixture.out_dir, "2026-06",
                [normalized(), normalized("가나다")],
                [transaction(), transaction("가나다", "2026-06-10")])
    assert fixture.run() == EXIT_OK

    by_name = {place["name"]: place["id"] for place in fixture.places()}
    assert by_name["까망염소"] == first_id
    assert by_name["가나다"] == "restaurant_000002"


def test_ids_are_never_reused(fixture: Fixture) -> None:
    """A number retired by hand does not come back on a different business."""
    fixture.id_map.write_text(json.dumps({"사라진집": "restaurant_000007"}), encoding="utf-8")
    assert fixture.run() == EXIT_OK
    assert fixture.places()[0]["id"] == "restaurant_000008"
    # The retired entry survives the write-back; the map is appended to, never rebuilt.
    assert load_id_map(fixture.id_map)["사라진집"] == "restaurant_000007"


def test_next_index_reads_the_highest_number_not_the_entry_count() -> None:
    assert next_index({}) == 1
    assert next_index({"a": "restaurant_000004"}) == 5
    assert next_index({"a": "restaurant_000004", "b": "restaurant_000002"}) == 5


def test_window_boundary_keeps_the_floor_date_and_drops_the_day_before(fixture: Fixture) -> None:
    """The rolling window is the span the 1y view renders; a day earlier is invisible there."""
    kept = WINDOW_START.isoformat()
    dropped = date(WINDOW_START.year, WINDOW_START.month - 1, 31).isoformat()
    write_month(fixture.out_dir, "2025-09", [normalized()],
                [transaction(when=kept), transaction(when=dropped)])
    assert fixture.run() == EXIT_OK
    dates = [item["date"] for place in fixture.places() for item in place["transactions"]]
    assert kept in dates
    assert dropped not in dates


def test_transactions_after_the_anchor_are_dropped(fixture: Fixture) -> None:
    write_month(fixture.out_dir, "2026-08", [normalized()],
                [transaction(when="2026-08-02")])
    assert fixture.run() == EXIT_OK
    dates = [item["date"] for place in fixture.places() for item in place["transactions"]]
    assert "2026-08-02" not in dates


def test_a_place_with_no_surviving_transaction_is_not_published(tmp_path: Path) -> None:
    """One place drops out; another still publishes, so the run is a real dataset."""
    built = Fixture(tmp_path)
    write_csv(built.candidates, [row(), row(canonical_name="만리장성", display_name="만리장성")])
    write_month(built.out_dir, "2024-01", [normalized(), normalized("만리장성")],
                [transaction(when="2024-01-05"), transaction("만리장성", "2026-07-02")])
    assert built.run() == EXIT_OK
    assert [place["name"] for place in built.places()] == ["만리장성"]


def test_approved_rows_and_month_data_that_yield_no_place_stop_the_build(
        tmp_path: Path) -> None:
    """Inputs present, output empty — the case the no-month-data guard does not cover.

    Every transaction dropped upstream (here, a date format the gate rejects) would otherwise
    write `places: []` and exit 0. The validator has no minimum-place check, so that empty file
    passes the gate and CI publishes a map with nothing on it.
    """
    built = Fixture(tmp_path)
    write_csv(built.candidates, [row()])
    write_month(built.out_dir, "2026-06", [normalized()], [transaction(when="20260603")])
    assert built.run() == EXIT_UNUSABLE
    assert not built.output.exists()


def test_no_approved_rows_is_not_an_error(fixture: Fixture) -> None:
    """The repo's actual state: every row still pending. An empty dataset is correct there."""
    write_csv(fixture.candidates, [row(status="pending")])
    assert fixture.run() == EXIT_OK
    assert fixture.places() == []


def test_visits_join_through_every_raw_spelling(fixture: Fixture) -> None:
    """The normalizer's merged spellings all count as the same place."""
    write_month(fixture.out_dir, "2026-06",
                [normalized(raw_names=["까망염소", "채순자의 까망염소"])],
                [transaction("까망염소", "2026-06-01"),
                 transaction("채순자의 까망염소", "2026-06-02")])
    assert fixture.run() == EXIT_OK
    assert len(fixture.places()[0]["transactions"]) == 3


def test_an_excluded_venue_contributes_nothing(fixture: Fixture) -> None:
    """A venue the classifier excluded is absent from `places`, so its rows find no home."""
    write_month(fixture.out_dir, "2026-06", [normalized()],
                [transaction("㈜금관유통", "2026-06-01")])
    assert fixture.run() == EXIT_OK
    assert len(fixture.places()[0]["transactions"]) == 1


def test_transactions_are_sorted_by_date(fixture: Fixture) -> None:
    write_month(fixture.out_dir, "2026-06", [normalized()],
                [transaction(when="2026-06-20"), transaction(when="2026-06-02")])
    assert fixture.run() == EXIT_OK
    dates = [item["date"] for item in fixture.places()[0]["transactions"]]
    assert dates == sorted(dates)


def test_a_month_directory_missing_a_file_is_skipped_not_fatal(fixture: Fixture) -> None:
    partial = fixture.out_dir / "2026-06"
    partial.mkdir(parents=True)
    (partial / "normalized_places.json").write_text("{}", encoding="utf-8")
    assert fixture.run() == EXIT_OK
    assert len(fixture.places()[0]["transactions"]) == 1


def test_a_row_with_no_category_publishes_as_기타(fixture: Fixture) -> None:
    """The loader rejects the whole file on an empty category, so it is never emitted empty."""
    write_csv(fixture.candidates, [row(category="")])
    assert fixture.run() == EXIT_OK
    assert fixture.places()[0]["category"] == UNCLASSIFIED_CATEGORY


@pytest.mark.parametrize("when", ["20260713", "2026-W28-1", "2026-07-13T00:00:00", "nonsense"])
def test_a_date_the_gate_would_reject_is_never_written(fixture: Fixture, when: str) -> None:
    """`date.fromisoformat` accepts more shapes than the wire format does, on 3.11+.

    The raw string is what reaches the dataset, so parsing with anything looser than the gate's
    own `parse_iso_date` would emit a date check 5 then rejects — the build and the gate
    disagreeing about what a date is.
    """
    write_month(fixture.out_dir, "2026-06", [normalized()], [transaction(when=when)])
    assert fixture.run() == EXIT_OK
    dates = [item["date"] for place in fixture.places() for item in place["transactions"]]
    assert when not in dates


def test_dropped_transactions_of_approved_places_are_reported(
        fixture: Fixture, capsys: Any) -> None:
    """Visits are the ranking signal; a silently absorbed one moves a place with nothing saying so."""
    write_month(fixture.out_dir, "2026-06", [normalized()],
                [transaction(when="20260601"), transaction(when="2026-06-02", amount=-500)])
    assert fixture.run() == EXIT_OK
    assert "dropped 2 transaction(s)" in capsys.readouterr().err


def test_an_out_of_window_transaction_is_not_reported_as_dropped(
        fixture: Fixture, capsys: Any) -> None:
    """Trimming is the job, not a defect — counting it would cry wolf on every run."""
    write_month(fixture.out_dir, "2024-01", [normalized()], [transaction(when="2024-01-05")])
    assert fixture.run() == EXIT_OK
    assert "dropped" not in capsys.readouterr().err


def test_naver_url_is_accepted_by_the_gate_that_guards_the_loader() -> None:
    url = naver_search_url("까망염소 / 본점?")
    assert naver_url_or_none(url) == url


def test_the_built_dataset_passes_the_validator(fixture: Fixture, capsys: Any) -> None:
    """End to end: the build's output is judged by the module that gates publication."""
    assert fixture.run() == EXIT_OK
    capsys.readouterr()
    assert validate_main([str(fixture.output), "--candidates", str(fixture.candidates)]) == 0


# --- Unicode normalization ---------------------------------------------------------------------

# The same Korean name reaches the CSV from two hands: a macOS paste carries the decomposed form,
# Naver's API the composed one. They are code-point-unequal and the same business, so every join
# below is keyed on NFC — otherwise one restaurant builds as two places with two IDs, and check 9
# reads a name the build wrote as having no review row.
NFD = unicodedata.normalize("NFD", "까망염소")


def test_a_decomposed_csv_name_publishes_one_place_the_gate_accepts(
        fixture: Fixture, capsys: Any) -> None:
    """The CSV in NFD, the normalizer's output in NFC — one place the gate agrees on."""
    write_csv(fixture.candidates, [row(canonical_name=NFD, display_name=NFD)])
    assert fixture.run() == EXIT_OK
    places = fixture.places()
    assert len(places) == 1
    assert places[0]["name"] == "까망염소"
    capsys.readouterr()
    assert validate_main([str(fixture.output), "--candidates", str(fixture.candidates)]) == 0


def test_one_name_approved_in_both_forms_stops_the_build(fixture: Fixture) -> None:
    """Two spellings of one business is the ambiguity Golden Principle 2 refuses to resolve."""
    write_csv(fixture.candidates, [row(), row(canonical_name=NFD, display_name=NFD)])
    assert fixture.run() == EXIT_UNUSABLE
    assert not fixture.output.exists()


def test_an_approved_name_repeated_in_the_other_form_on_an_unapproved_row_stops_the_build(
        fixture: Fixture) -> None:
    """The same row-counting rule, reached through normalization rather than a literal repeat."""
    write_csv(fixture.candidates, [
        row(),
        row(status="rejected", canonical_name="만리장성", display_name=NFD),
    ])
    assert fixture.run() == EXIT_UNUSABLE
    assert not fixture.output.exists()


def test_visits_join_across_a_normalization_mismatch(fixture: Fixture) -> None:
    """A decomposed `normalized_places.json` against a composed CSV still attributes its visits."""
    write_month(fixture.out_dir, "2026-06",
                [normalized(NFD, raw_names=[NFD])],
                [transaction(NFD, "2026-06-01")])
    assert fixture.run() == EXIT_OK
    assert len(fixture.places()[0]["transactions"]) == 2


def test_the_two_forms_share_one_id(fixture: Fixture) -> None:
    """A re-approval typed in the other form must not mint a second ID for the same place."""
    assert fixture.run() == EXIT_OK
    first_id = fixture.places()[0]["id"]

    write_csv(fixture.candidates, [row(canonical_name=NFD, display_name=NFD)])
    assert fixture.run() == EXIT_OK
    assert fixture.places()[0]["id"] == first_id


def test_a_decomposed_id_map_entry_is_not_minted_a_second_id(fixture: Fixture) -> None:
    """The map is committed and hand-edited; a decomposed key still names the place it names."""
    fixture.id_map.write_text(json.dumps({NFD: "restaurant_000007"}, ensure_ascii=False),
                              encoding="utf-8")
    assert fixture.run() == EXIT_OK
    assert fixture.places()[0]["id"] == "restaurant_000007"
