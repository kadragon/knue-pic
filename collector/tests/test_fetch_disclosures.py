"""Stage 1 walk rules — the backfill regression and the wrong-year guard.

`.claude/skills/*/scripts/` has no test home of its own (a separate backlog
item), so this file loads the one module under test by path rather than
standing up a general harness for every skill script.
"""

import importlib.util
import pathlib

import pytest

_SCRIPT = (pathlib.Path(__file__).resolve().parents[2]
           / ".claude/skills/knue-expense-collect/scripts/fetch_disclosures.py")


def _load():
    spec = importlib.util.spec_from_file_location("fetch_disclosures", _SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


fd = _load()


def _board(monkeypatch, pages):
    """Serve `pages` (a list of row lists) to both traversals, and count reads."""
    read: list[int] = []

    def fake_list_url(page, keyword=None):
        return f"page={page}"

    def fake_fetch_text(url):
        return url

    def fake_parse_rows(url):
        page = int(url.split("=")[1])
        read.append(page)
        return pages[page - 1] if page <= len(pages) else []

    monkeypatch.setattr(fd, "list_url", fake_list_url)
    monkeypatch.setattr(fd, "fetch_text", fake_fetch_text)
    monkeypatch.setattr(fd, "parse_rows", fake_parse_rows)
    return read


def _post(ntt_no, label):
    return (str(ntt_no), f"[기획처] {label} 업무추진비 공개")


def test_backfill_reaches_a_month_far_down_the_board(monkeypatch):
    """The bug: a fixed quiet-page budget stopped before the requested month.

    2025-06 sits 20 pages down behind a run of unrelated notices; the old rule
    (stop after 3 consecutive pages with no match) returned the 2026-06 posts
    from the top of the board instead.
    """
    pages = [[_post(900 + i, "2026년 6월")] for i in range(3)]
    pages += [[("500", "[총무과] 일반 공지")] for _ in range(17)]
    pages += [[_post(100, "2025년 6월")]]
    _board(monkeypatch, pages)

    posts = fd.collect_posts(2025, 6, max_pages=50, quiet_pages=3)

    assert "2025-06" in {m for p in posts for m in p["titleMonths"]}


def test_walk_stops_once_the_board_passes_the_month(monkeypatch):
    """Reaching back must not mean reading the whole board every run."""
    pages = [[_post(900, "2026년 8월")]]
    pages += [[_post(800 - i, "2026년 7월")] for i in range(3)]
    pages += [[("500", "[총무과] 일반 공지")] for _ in range(40)]
    read = _board(monkeypatch, pages)

    fd.collect_posts(2026, 7, max_pages=50, quiet_pages=3)

    # Two traversals, each stopping 3 quiet pages after page 4.
    assert max(read) <= 7


def test_one_mistitled_post_does_not_declare_the_month_passed(monkeypatch):
    """2026-07's 교육연구원 post is titled "2025년 7월" — a real, misdated post.

    Judging "the board has passed the month" per row would let that single
    title end the walk on page 1.
    """
    pages = [[_post(900, "2025년 7월"), _post(899, "2026년 8월")]]
    pages += [[("500", "[총무과] 일반 공지")] for _ in range(5)]
    pages += [[_post(700, "2026년 7월")]]
    _board(monkeypatch, pages)

    posts = fd.collect_posts(2026, 7, max_pages=20, quiet_pages=3)

    assert "700" in {p["nttNo"] for p in posts}


@pytest.mark.parametrize("titles, expected", [
    ([["2026-06"]], True),
    ([["2026-06"], ["2025-06"]], False),
    ([["2025-06"], []], False),
    ([[]], False),
    ([], False),
])
def test_wrong_year_only(titles, expected):
    posts = [{"titleMonths": t} for t in titles]
    assert fd.wrong_year_only(posts, 2025, 6) is expected
