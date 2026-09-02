"""Stage 4's ``--report`` — cluster proposal and the operator-error exits.

``--report`` reads the committed review queue only: no credentials, no month, no
network. So the whole flag is testable end to end from fixtures in ``tmp_path``,
which is what the rest of the geocoder is not.

Two directions matter here. A cluster the report *fails to open* is a merge the
reviewer never makes, so every skip rule is asserted from a row that must not be
grouped. And an operator's slip — a truncated alias map, a directory where a CSV
belongs — must land as a message and exit 2 like the missing-CSV case, never as a
traceback: the difference is whether the operator reads a fix or a stack.
"""

from __future__ import annotations

import csv
import json

from collector.tests.skill_scripts import load_skill_script

gc = load_skill_script("geocode_candidates")


def _row(name, lat="36.6", lng="127.3", visits="1", status="approved", **extra):
    row = {
        "status": status,
        "canonical_name": name,
        "display_name": name,
        "naver_title": name,
        "lat": lat,
        "lng": lng,
        "visits": visits,
    }
    row.update(extra)
    return row


def _write_csv(path, rows):
    with open(path, "w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(gc.FIELDS), extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


# --- coordinate_clusters ----------------------------------------------------


def test_two_spellings_at_one_coordinate_are_a_cluster():
    clusters = gc.coordinate_clusters([_row("가게"), _row("가계")])
    assert len(clusters) == 1
    key, members = clusters[0]
    assert key == "36.6,127.3"
    assert {m["canonical_name"] for m in members} == {"가게", "가계"}


def test_one_name_repeated_at_a_coordinate_is_not_a_cluster():
    # Same business twice is already merged; only ≥2 *distinct* names is a decision.
    assert gc.coordinate_clusters([_row("가게"), _row("가게")]) == []


def test_pending_and_rejected_rows_never_join_a_cluster():
    rows = [
        _row("가게"),
        _row("가계", status="pending"),
        _row("가개", status="rejected"),
    ]
    assert gc.coordinate_clusters(rows) == []


def test_a_row_without_coordinates_is_skipped():
    # Blank lat/lng would otherwise collide into one ","-keyed pseudo-cluster
    # holding every ungeocoded place.
    rows = [_row("가게", lat="", lng=""), _row("가계", lat="", lng="")]
    assert gc.coordinate_clusters(rows) == []


def test_clusters_are_ordered_by_visit_total():
    rows = [
        _row("작은가게", lat="36.1", visits="2"),
        _row("작은가계", lat="36.1", visits="1"),
        _row("큰가게", lat="36.2", visits="30"),
        _row("큰가계", lat="36.2", visits="5"),
    ]
    keys = [key for key, _ in gc.coordinate_clusters(rows)]
    assert keys == ["36.2,127.3", "36.1,127.3"]


def test_an_unparsable_visit_count_does_not_break_the_sort():
    rows = [_row("가게", visits="많음"), _row("가계", visits="3")]
    clusters = gc.coordinate_clusters(rows)
    assert len(clusters) == 1


# --- report: the decision it prints -----------------------------------------


def test_report_says_nothing_to_decide_when_no_coordinate_is_shared(tmp_path, capsys):
    csv_path = tmp_path / "review_candidates.csv"
    _write_csv(csv_path, [_row("가게"), _row("다른가게", lat="36.7")])
    aliases = tmp_path / "aliases.json"
    aliases.write_text("{}", encoding="utf-8")

    assert gc.report(str(csv_path), str(aliases)) == 0
    assert "No same-coordinate clusters" in capsys.readouterr().out


def test_a_fully_merged_cluster_is_not_re_proposed(tmp_path, capsys):
    csv_path = tmp_path / "review_candidates.csv"
    _write_csv(csv_path, [_row("가게"), _row("가계")])
    aliases = tmp_path / "aliases.json"
    aliases.write_text(json.dumps({"가계": "가게"}, ensure_ascii=False), encoding="utf-8")

    assert gc.report(str(csv_path), str(aliases)) == 0
    out = capsys.readouterr().out
    assert "nothing to decide" in out
    assert "awaiting a merge decision" not in out


def test_a_partly_merged_cluster_still_opens(tmp_path, capsys):
    # {"A": "C", "X": "B"} leaves A and B publishing as two places at one point
    # with nothing unmapped — the case "every name is mapped" would miss.
    csv_path = tmp_path / "review_candidates.csv"
    _write_csv(csv_path, [_row("A", visits="4"), _row("X", visits="2")])
    aliases = tmp_path / "aliases.json"
    aliases.write_text(json.dumps({"A": "C", "X": "B"}), encoding="utf-8")

    assert gc.report(str(csv_path), str(aliases)) == 0
    out = capsys.readouterr().out
    assert "awaiting a merge decision" in out
    assert "36.6,127.3" in out
    assert "→ C" in out and "→ B" in out


def test_a_missing_alias_file_is_not_an_error(tmp_path, capsys):
    # The map is optional: a repo that has merged nothing yet still gets a report.
    csv_path = tmp_path / "review_candidates.csv"
    _write_csv(csv_path, [_row("가게"), _row("가계")])

    assert gc.report(str(csv_path), str(tmp_path / "absent.json")) == 0
    assert "awaiting a merge decision" in capsys.readouterr().out


# --- report: operator error -------------------------------------------------


def test_a_missing_csv_exits_2_with_a_message(tmp_path, capsys):
    assert gc.report(str(tmp_path / "absent.csv"), str(tmp_path / "aliases.json")) == 2
    assert "does not exist" in capsys.readouterr().err


def test_a_directory_passed_as_the_csv_exits_2_with_a_message(tmp_path, capsys):
    target = tmp_path / "collector"
    target.mkdir()

    assert gc.report(str(target), str(tmp_path / "aliases.json")) == 2
    err = capsys.readouterr().err
    assert "is a directory" in err
    assert str(target) in err


def test_a_malformed_alias_file_exits_2_with_a_message(tmp_path, capsys):
    csv_path = tmp_path / "review_candidates.csv"
    _write_csv(csv_path, [_row("가게"), _row("가계")])
    aliases = tmp_path / "aliases.json"
    aliases.write_text('{"가계": "가게"', encoding="utf-8")  # truncated

    assert gc.report(str(csv_path), str(aliases)) == 2
    captured = capsys.readouterr()
    assert str(aliases) in captured.err
    # Silently falling back to an empty map would re-propose settled clusters.
    assert "awaiting a merge decision" not in captured.out


def test_an_alias_file_that_is_not_an_object_exits_2(tmp_path, capsys):
    csv_path = tmp_path / "review_candidates.csv"
    _write_csv(csv_path, [_row("가게"), _row("가계")])
    aliases = tmp_path / "aliases.json"
    aliases.write_text('["가계", "가게"]', encoding="utf-8")

    assert gc.report(str(csv_path), str(aliases)) == 2
    assert str(aliases) in capsys.readouterr().err
