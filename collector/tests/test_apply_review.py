"""``apply_review.py`` — transcribing the reviewer's verdicts, and nothing else.

The queue exists so that no agent decides a venue's status. That guarantee is
only as good as the write: a script that rewrites the whole file is one bad
index away from approving a place the reviewer never saw, which is exactly what
Golden Principle 2 forbids. So the load-bearing test here is the *negative* one
— every row not named on the command line must come back byte-for-byte, status
and reviewer-added columns included.

The operator-error cases matter for the same reason from the other side. A
mistyped name that silently writes nothing looks identical to a verdict that
landed, and the reviewer would only find out a month later when the place is
missing from the map. Both slips must exit non-zero with the name in the
message, before anything is written.
"""

from __future__ import annotations

import csv

import pytest

from collector.tests.skill_scripts import load_skill_script

ar = load_skill_script("apply_review")

COLUMNS = [
    "status", "canonical_name", "display_name", "raw_names", "months", "visits",
    "naver_title", "category", "address", "road_address", "lat", "lng",
    "candidate_count", "region_ok", "category_ok", "query", "note",
]


def _row(name, status="pending", **extra):
    row = {key: "" for key in COLUMNS}
    row.update(status=status, canonical_name=name, display_name=name, note=f"note for {name}")
    row.update(extra)
    return row


def _write_csv(path, rows, columns=COLUMNS):
    with open(path, "w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=columns)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: row.get(key, "") for key in columns})


def _read_csv(path):
    with open(path, encoding="utf-8", newline="") as fh:
        return list(csv.DictReader(fh))


def _run(monkeypatch, csv_path, *argv):
    monkeypatch.setattr("sys.argv", ["apply_review.py", "--csv", str(csv_path), *argv])
    return ar.main()


def test_only_named_rows_change_status(tmp_path, monkeypatch):
    """The one assertion the script exists for: an unnamed row is not decided."""
    path = tmp_path / "queue.csv"
    _write_csv(path, [
        _row("까망염소"),
        _row("봉땅", status="rejected"),
        _row("금관유통"),
        _row("오송송파스타", status="approved"),
    ])

    assert _run(monkeypatch, path, "--approve", "까망염소", "봉땅", "--reject", "금관유통") == 0

    after = {row["canonical_name"]: row for row in _read_csv(path)}
    assert after["까망염소"]["status"] == "approved"
    assert after["봉땅"]["status"] == "approved"
    assert after["금관유통"]["status"] == "rejected"
    # Named nowhere on the command line, so its verdict is still the reviewer's.
    assert after["오송송파스타"]["status"] == "approved"


def test_unnamed_rows_round_trip_untouched(tmp_path, monkeypatch):
    """Every column of an unnamed row survives, including one stage 4 never wrote."""
    columns = COLUMNS + ["reviewer_note"]
    path = tmp_path / "queue.csv"
    untouched = _row("행포케오송점", status="rejected", note="회식; 2026-08", reviewer_note="확인함")
    _write_csv(path, [_row("까망염소"), untouched], columns=columns)
    before = _read_csv(path)[1]

    assert _run(monkeypatch, path, "--approve", "까망염소") == 0

    assert _read_csv(path)[1] == before


def test_unknown_name_writes_nothing(tmp_path, monkeypatch):
    path = tmp_path / "queue.csv"
    _write_csv(path, [_row("까망염소")])
    before = path.read_bytes()

    with pytest.raises(SystemExit) as excinfo:
        _run(monkeypatch, path, "--approve", "까망염소", "없는가게")

    assert "없는가게" in str(excinfo.value)
    # The valid half of the verdict must not land either: a partial write leaves
    # the reviewer guessing which names took.
    assert path.read_bytes() == before


def test_same_name_approved_and_rejected_is_an_error(tmp_path, monkeypatch):
    path = tmp_path / "queue.csv"
    _write_csv(path, [_row("까망염소")])
    before = path.read_bytes()

    with pytest.raises(SystemExit) as excinfo:
        _run(monkeypatch, path, "--approve", "까망염소", "--reject", "까망염소")

    assert "까망염소" in str(excinfo.value)
    assert path.read_bytes() == before


def test_ambiguous_canonical_name_is_an_error(tmp_path, monkeypatch):
    """One name on two rows: writing both would pick which one the reviewer meant."""
    path = tmp_path / "queue.csv"
    _write_csv(path, [_row("본도시락"), _row("본도시락", status="rejected")])
    before = path.read_bytes()

    with pytest.raises(SystemExit) as excinfo:
        _run(monkeypatch, path, "--approve", "본도시락")

    assert "본도시락" in str(excinfo.value)
    assert path.read_bytes() == before


def test_no_names_is_an_error(tmp_path, monkeypatch):
    path = tmp_path / "queue.csv"
    _write_csv(path, [_row("까망염소")])

    with pytest.raises(SystemExit):
        _run(monkeypatch, path)


def test_already_carrying_the_verdict_leaves_the_file_alone(tmp_path, monkeypatch):
    path = tmp_path / "queue.csv"
    _write_csv(path, [_row("까망염소", status="approved")])
    before = path.read_bytes()

    assert _run(monkeypatch, path, "--approve", "까망염소") == 0

    assert path.read_bytes() == before
