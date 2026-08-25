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


def collect_posts(year: int, month: int, max_pages: int, quiet_pages: int) -> list[dict]:
    """Walk title-search results, then plain pages, until the board passes the month.

    Both traversals are cheap and each catches something the other misses:
    the search skips unrelated notices, the plain listing catches posts whose
    title spells 업무추진비 differently or omits it in a combined disclosure.

    The quiet-page budget only becomes a stop rule once the walk has evidence
    it is at or past the requested month: either the month's own posts have
    been seen, or a page's dated 업무추진비 rows are all older than it. On its
    own the budget silently under-walks a backfill — the month simply sits
    further down the board than the budget reaches, and the run then reports
    posts from the same month of a different year.
    """
    target = (year, month)
    found: dict[str, dict] = {}
    for keyword in (KEYWORD, None):
        misses = 0
        reached_target = False
        for page in range(1, max_pages + 1):
            rows = parse_rows(fetch_text(list_url(page, keyword)))
            if not rows:
                break
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
                if (year, month) in months:
                    reached_target = True
                found.setdefault(
                    ntt_no,
                    {
                        "nttNo": ntt_no,
                        "title": title,
                        "department": department(title),
                        "titleMonths": sorted(f"{y:04d}-{m:02d}" for y, m in months),
                    },
                )
            # Judged per page, not per row: a single mistitled post near the top
            # of the board would otherwise declare the target passed on page 1.
            if dated_this_page and all(max(ms) < target for ms in dated_this_page):
                reached_target = True
            misses = 0 if hit_this_page else misses + 1
            if reached_target and misses >= quiet_pages:
                break
    return sorted(found.values(), key=lambda p: -int(p["nttNo"]))


def wrong_year_only(posts: list[dict], year: int, month: int) -> bool:
    """True when every dated post carries a year other than the requested one.

    This is the failure the positional walk is meant to prevent, kept as a
    second line: matching on the month number alone makes a short walk return
    a plausible post count from the wrong year, and stage 2 then finds no rows
    for the target month — which reads as "the board layout changed".
    """
    stamp = f"{year:04d}-{month:02d}"
    dated = [p for p in posts if p["titleMonths"]]
    return bool(dated) and not any(stamp in p["titleMonths"] for p in dated)


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
        print(f"{args.month}: every dated post found carries a different year"
              f" ({', '.join(sorted({m for p in posts for m in p['titleMonths']}))})."
              " The walk never reached the requested month; raise --max-pages, or pass"
              " --allow-title-year-mismatch if the titles really are misdated.",
              file=sys.stderr)
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
