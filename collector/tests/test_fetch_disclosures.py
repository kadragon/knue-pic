"""Stage 1 walk rules — the backfill regression and the wrong-year guard.

The module under test lives in `.claude/skills/*/scripts/`, outside the
`collector` package; `skill_scripts.load_skill_script` is how this test run
reaches it (see that module for why the scripts are tested from here).
"""

import pytest

from collector.tests.skill_scripts import load_skill_script

fd = load_skill_script("fetch_disclosures")


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


def _notices(count, start=500):
    """`count` pages of one unrelated notice each, with distinct nttNo values.

    Distinct ids matter: identical consecutive pages are how the walk detects a
    board that clamps an out-of-range pageIndex, so a fixture that reuses one
    row would stop the walk for the wrong reason.
    """
    return [[(str(start + i), "[총무과] 일반 공지")] for i in range(count)]


def test_backfill_reaches_a_month_far_down_the_board(monkeypatch):
    """The bug: a fixed quiet-page budget stopped before the requested month.

    2025-06 sits 20 pages down behind a run of unrelated notices; the old rule
    (stop after 3 consecutive pages with no match) returned the 2026-06 posts
    from the top of the board instead.
    """
    pages = [[_post(900 + i, "2026년 6월")] for i in range(3)]
    pages += _notices(17, start=500 + 10 * len(pages))
    pages += [[_post(100, "2025년 6월")]]
    _board(monkeypatch, pages)

    posts = fd.collect_posts(2025, 6, max_pages=50, quiet_pages=3)

    assert "2025-06" in {m for p in posts for m in p["titleMonths"]}


def test_walk_stops_once_the_board_passes_the_month(monkeypatch):
    """Reaching back must not mean reading the whole board every run.

    The board carries older months below the target, which is what arms the
    quiet-page stop — the month's own posts deliberately do not.
    """
    pages = [[_post(900, "2026년 8월")]]
    pages += [[_post(800 - i, "2026년 7월")] for i in range(3)]
    pages += [[_post(700 - i, "2026년 6월")] for i in range(2)]
    pages += _notices(40, start=500 + 10 * len(pages))
    read = _board(monkeypatch, pages)

    fd.collect_posts(2026, 7, max_pages=50, quiet_pages=3)

    # Two traversals, each armed by pages 5-6 and stopping 3 quiet pages later.
    assert max(read) <= 9


def test_one_mistitled_post_does_not_declare_the_month_passed(monkeypatch):
    """2026-07's 교육연구원 post is titled "2025년 7월" — a real, misdated post.

    Judging "the board has passed the month" per row would let that single
    title end the walk on page 1.
    """
    pages = [[_post(900, "2025년 7월"), _post(899, "2026년 8월")]]
    pages += _notices(5, start=500 + 10 * len(pages))
    pages += [[_post(700, "2026년 7월")]]
    _board(monkeypatch, pages)

    posts = fd.collect_posts(2026, 7, max_pages=20, quiet_pages=3)

    assert "700" in {p["nttNo"] for p in posts}


def test_a_lone_misdated_post_does_not_arm_the_stop(monkeypatch):
    """The single-row case: one misdated post is a whole page's dated evidence.

    On the plain listing a page typically carries one dated 업무추진비 row, so
    an all-rows-older test is satisfied by that row alone — which is how a
    misdated title used to end the walk before the real month was reached.
    """
    pages = [[_post(900, "2025년 7월"), ("501", "[총무과] 일반 공지")]]
    pages += _notices(5, start=500 + 10 * len(pages))
    pages += [[_post(700, "2026년 7월")]]
    _board(monkeypatch, pages)

    posts = fd.collect_posts(2026, 7, max_pages=20, quiet_pages=3)

    assert "700" in {p["nttNo"] for p in posts}


def test_quiet_pages_before_the_target_do_not_shorten_the_budget(monkeypatch):
    """Misses read above the month say nothing about where the walk is.

    Carrying them across the moment the board passes the target spends the
    whole budget on the first page past it.
    """
    pages = [[_post(900 + i, "2026년 6월")] for i in range(3)]
    pages += _notices(17, start=500 + 10 * len(pages))
    pages += [[_post(120, "2025년 5월")], [_post(110, "2025년 5월")]]
    pages += [[_post(100, "2025년 6월")]]
    _board(monkeypatch, pages)

    posts = fd.collect_posts(2025, 6, max_pages=50, quiet_pages=3)

    assert "100" in {p["nttNo"] for p in posts}


def test_the_month_own_posts_do_not_arm_the_stop(monkeypatch):
    """A month's posts are spread out; a gap must not end the walk mid-month."""
    pages = [[_post(900, "2026년 7월")]]
    pages += _notices(6, start=500 + 10 * len(pages))
    pages += [[_post(800, "2026년 7월")]]
    _board(monkeypatch, pages)

    posts = fd.collect_posts(2026, 7, max_pages=20, quiet_pages=3)

    assert {"900", "800"} <= {p["nttNo"] for p in posts}


def test_arming_pages_must_be_consecutive(monkeypatch):
    """Undated pages must not preserve a partial all-older count.

    Two lone misdated posts nine pages apart are two typos, not the board
    moving past the month; letting the count survive the pages between them
    ends the walk mid-month and exits 0 with a silently partial collection,
    which the year guard cannot catch — the first cluster carries the right
    stamp.
    """
    pages = [[_post(950, "2026년 7월")], [_post(940, "2025년 7월")]]
    pages += _notices(7, start=500 + 10 * len(pages))
    pages += [[_post(930, "2025년 7월")]]
    pages += _notices(9, start=500 + 10 * len(pages))
    pages += [[_post(500, "2026년 7월")], [_post(490, "2026년 7월")]]
    _board(monkeypatch, pages)

    posts = fd.collect_posts(2026, 7, max_pages=50, quiet_pages=3)

    assert {"950", "500", "490"} <= {p["nttNo"] for p in posts}


def test_a_clamping_board_does_not_run_to_max_pages(monkeypatch):
    """An out-of-range pageIndex that re-serves the last page must not loop."""
    last = [_post(900, "2026년 8월")]
    read = _board(monkeypatch, [last] * 300)

    fd.collect_posts(2020, 6, max_pages=200, quiet_pages=3)

    assert max(read) <= 2


@pytest.mark.parametrize("titles, expected", [
    ([["2026-06"]], True),
    ([["2026-06"], ["2025-06"]], False),
    # An undated post is indeterminate, not wrong-year: the attachment decides
    # its month, so its presence must not let the guard refuse the run.
    ([["2026-06"], []], False),
    ([["2025-06"], []], False),
    ([[]], False),
    ([], False),
])
def test_wrong_year_only(titles, expected):
    posts = [{"titleMonths": t} for t in titles]
    assert fd.wrong_year_only(posts, 2025, 6) is expected
