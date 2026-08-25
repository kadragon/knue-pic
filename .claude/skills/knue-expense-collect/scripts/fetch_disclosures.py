#!/usr/bin/env python3
"""Stage 1 — collect one month's 업무추진비 disclosure posts and attachments.

Usage:
    python3 fetch_disclosures.py --month 2026-07 [--out-dir collector/out]

Any month the board still carries works, recent or backfilled: the walk reads
down the listing until it passes the requested month, and refuses rather than
returning same-month posts from another year.

Writes <out-dir>/<month>/raw/ with the attachment files and
<out-dir>/<month>/posts.json describing what was downloaded and what was
deliberately skipped. Nothing here interprets the spreadsheet contents.

Exit codes: 0 collected; 1 no post matched the month; 2 malformed --month;
3 every post found is dated to another year, so nothing was downloaded.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from knue_board import (  # noqa: E402
    attachments,
    department,
    download_attachment,
    fetch_text,
    list_url,
    parse_rows,
    title_months,
)

KEYWORD = "업무추진비"
# 총장 업무추진비 is published without a 사용처 column, so no place can be
# derived from it. Skipping it here keeps stage 2's failure log meaningful.
SKIP_DEPARTMENTS = {"비서실"}

# One page is not evidence the board has passed the requested month: on the
# plain listing a page typically carries a single dated 업무추진비 row, and a
# misdated one ("2025년 7월" on a real 2026-07 post) would satisfy an
# all-rows-older test on its own. Two consecutive such pages cannot come from
# one misdated title.
PAGES_PAST_TARGET = 2


def collect_posts(year: int, month: int, max_pages: int, quiet_pages: int) -> list[dict]:
    """Walk title-search results, then plain pages, until the board passes the month.

    Both traversals are cheap and each catches something the other misses:
    the search skips unrelated notices, the plain listing catches posts whose
    title spells 업무추진비 differently or omits it in a combined disclosure.

    The stop rule is positional. The board is ordered newest first, so the
    quiet-page budget only becomes a stop rule once PAGES_PAST_TARGET pages in
    a row have carried dated 업무추진비 rows that are *all* older than the
    requested month. A fixed budget alone silently under-walks a backfill — the
    month simply sits further down the board than the budget reaches, and the
    run then reports posts from the same month of a different year.

    Having seen the month's own posts is deliberately NOT arming evidence. A
    month's departmental posts are spread over several pages and the plain
    listing interleaves unrelated notices, so a gap wider than the budget
    between two clusters of the same month would end the walk mid-month — a
    silent partial collection that the year guard below cannot catch, because
    the first cluster already carries the right stamp.
    """
    target = (year, month)
    found: dict[str, dict] = {}
    for keyword in (KEYWORD, None):
        misses = 0
        older_pages = 0
        past_target = False
        previous: list[tuple[str, str]] | None = None
        for page in range(1, max_pages + 1):
            rows = parse_rows(fetch_text(list_url(page, keyword)))
            # A board that clamps an out-of-range pageIndex to its last page
            # serves that page forever; without this the walk would only stop
            # at --max-pages. Distinct nttNo values make a false match on two
            # genuinely different pages impossible.
            if not rows or rows == previous:
                break
            previous = rows
            hit_this_page = False
            dated_this_page: list[set[tuple[int, int]]] = []
            for ntt_no, title in rows:
                if KEYWORD not in title:
                    continue
                months = title_months(title)
                if months:
                    dated_this_page.append(months)
                # An unparseable title is kept: the attachment decides. So is a
                # title whose month matches but whose year does not — 2026-07's
                # 교육연구원 post is titled "2025년 7월". Stage 2 filters on the
                # date cells, so a false positive here costs one download.
                if months and month not in {m for _, m in months}:
                    continue
                hit_this_page = True
                found.setdefault(
                    ntt_no,
                    {
                        "nttNo": ntt_no,
                        "title": title,
                        "department": department(title),
                        "titleMonths": sorted(f"{y:04d}-{m:02d}" for y, m in months),
                    },
                )
            # Reset on every page that is not itself all-older, undated pages
            # included: letting an undated page preserve a partial count lets
            # two lone misdated posts pages apart arm the stop between them.
            older_pages = (older_pages + 1
                           if dated_this_page
                           and all(max(ms) < target for ms in dated_this_page)
                           else 0)
            # Latched: two consecutive all-older pages is board ordering, not a
            # title typo, and the walk does not un-pass a month it has passed.
            past_target = past_target or older_pages >= PAGES_PAST_TARGET
            # Quiet pages read before the board passed the month say nothing
            # about where the walk is, so they must not accumulate: carrying a
            # stale count across the moment the walk arrives would spend the
            # whole budget on the first page past the target.
            misses = (0 if hit_this_page else misses + 1) if past_target else 0
            if past_target and misses >= quiet_pages:
                break
    return sorted(found.values(), key=lambda p: -int(p["nttNo"]))


def wrong_year_only(posts: list[dict], year: int, month: int) -> bool:
    """True when every post found is dated and carries a year other than ours.

    The failure this guards is a walk that stopped above the requested month
    and returned the same month of a different year: a plausible post count
    that leaves stage 2 with no rows for the target month, which reads as "the
    board layout changed".

    A post whose title has no parseable year is indeterminate, not evidence —
    it is kept precisely because the attachment decides its month. One such
    post therefore disables the guard rather than being refused alongside the
    wrong-year ones, and a run where *no* post carries a year cannot be judged
    here at all; stage 2's date cells remain the authority in both cases.
    """
    stamp = f"{year:04d}-{month:02d}"
    if any(not p["titleMonths"] for p in posts):
        return False
    return bool(posts) and not any(stamp in p["titleMonths"] for p in posts)


def drop_superseded(posts: list[dict]) -> tuple[list[dict], list[dict]]:
    """Keep the highest nttNo per department *for the same declared months*.

    Keying on department alone was wrong: posts with unparseable titles are kept
    on purpose ("the attachment decides"), and such a post from a later month
    carries a higher nttNo, so it would silently supersede the real target-month
    post and that department would contribute nothing — logged as `superseded:`,
    which reads like intended behaviour. Including the title months in the key
    means only a genuine re-post of the same month can supersede, and stage 2's
    date filter still throws out anything off-month.
    """
    best: dict[tuple, dict] = {}
    for post in posts:
        key = (post["department"], tuple(post["titleMonths"]) or (post["nttNo"],))
        if key not in best or int(post["nttNo"]) > int(best[key]["nttNo"]):
            best[key] = post
    kept_ids = {p["nttNo"] for p in best.values()}
    kept = [p for p in posts if p["nttNo"] in kept_ids]
    superseded = [p for p in posts if p["nttNo"] not in kept_ids]
    return kept, superseded


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--month", required=True, help="target month, YYYY-MM")
    ap.add_argument("--out-dir", default="collector/out")
    ap.add_argument("--max-pages", type=int, default=200,
                    help="runaway cap on pages read per traversal, not a tuning knob:"
                         " the walk normally stops once the board passes the month")
    ap.add_argument("--quiet-pages", type=int, default=3,
                    help="after the board has passed the requested month, stop this many"
                         " consecutive pages with no match")
    ap.add_argument("--allow-title-year-mismatch", action="store_true",
                    help="collect even when every matched post's title carries another year")
    args = ap.parse_args()

    if not re.fullmatch(r"\d{4}-\d{2}", args.month):
        print(f"--month must be YYYY-MM, got {args.month!r}", file=sys.stderr)
        return 2
    year, month = (int(part) for part in args.month.split("-"))
    if not 1 <= month <= 12:
        print(f"--month must name a real month, got {args.month!r}", file=sys.stderr)
        return 2

    posts = collect_posts(year, month, args.max_pages, args.quiet_pages)
    if wrong_year_only(posts, year, month) and not args.allow_title_year_mismatch:
        years = ', '.join(sorted({m for p in posts for m in p['titleMonths']}))
        print(f"{args.month}: every post found is dated to another year ({years}), so"
              " nothing was downloaded. Either the month was never published, or it sits"
              f" below where the walk ended — raise --max-pages ({args.max_pages}) if the"
              " board is deeper than that. Pass --allow-title-year-mismatch if the titles"
              " really are misdated.", file=sys.stderr)
        return 3
    posts, superseded = drop_superseded(posts)

    skipped = [p for p in posts if p["department"] in SKIP_DEPARTMENTS]
    posts = [p for p in posts if p["department"] not in SKIP_DEPARTMENTS]

    root = os.path.join(args.out_dir, args.month)
    raw = os.path.join(root, "raw")
    os.makedirs(raw, exist_ok=True)

    for post in posts:
        files = []
        for atch_no in attachments(post["nttNo"]):
            name, data = download_attachment(atch_no)
            ext = os.path.splitext(name)[1].lower() or ".bin"
            path = os.path.join(raw, f"{post['nttNo']}_{atch_no}{ext}")
            with open(path, "wb") as fh:
                fh.write(data)
            files.append({"atchmnflNo": atch_no, "filename": name,
                          "path": os.path.relpath(path, root), "bytes": len(data)})
        post["files"] = files

    manifest = {
        "month": args.month,
        "posts": posts,
        "skippedDepartments": skipped,
        "supersededPosts": superseded,
    }
    with open(os.path.join(root, "posts.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=1)

    total_files = sum(len(p["files"]) for p in posts)
    print(f"{args.month}: {len(posts)} posts, {total_files} attachments -> {root}")
    for post in superseded:
        print(f"  superseded: {post['nttNo']} {post['title']}")
    for post in skipped:
        print(f"  skipped (no 사용처 column): {post['nttNo']} {post['title']}")
    if not posts:
        print("no posts matched. The walk reads until the board passes the requested"
              f" month or --max-pages ({args.max_pages}) runs out, so a zero here means"
              " either the month was never published or the cap was hit first.",
              file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
