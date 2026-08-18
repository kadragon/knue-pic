#!/usr/bin/env python3
"""Stage 1 — collect one month's 업무추진비 disclosure posts and attachments.

Usage:
    python3 fetch_disclosures.py --month 2026-07 [--out-dir collector/out]

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


def collect_posts(month: int, max_pages: int, quiet_pages: int) -> list[dict]:
    """Walk title-search results, then plain pages, until the month runs out.

    Both traversals are cheap and each catches something the other misses:
    the search skips unrelated notices, the plain listing catches posts whose
    title spells 업무추진비 differently or omits it in a combined disclosure.
    """
    found: dict[str, dict] = {}
    for keyword in (KEYWORD, None):
        misses = 0
        for page in range(1, max_pages + 1):
            rows = parse_rows(fetch_text(list_url(page, keyword)))
            if not rows:
                break
            hit_this_page = False
            for ntt_no, title in rows:
                if KEYWORD not in title:
                    continue
                months = title_months(title)
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
            misses = 0 if hit_this_page else misses + 1
            if misses >= quiet_pages:
                break
    return sorted(found.values(), key=lambda p: -int(p["nttNo"]))


def drop_superseded(posts: list[dict]) -> tuple[list[dict], list[dict]]:
    """Keep the highest nttNo per department; a re-post is a correction."""
    best: dict[str, dict] = {}
    for post in posts:
        key = post["department"]
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
    ap.add_argument("--max-pages", type=int, default=25)
    ap.add_argument("--quiet-pages", type=int, default=3,
                    help="stop after this many consecutive pages with no match")
    args = ap.parse_args()

    if not re.fullmatch(r"\d{4}-\d{2}", args.month):
        print(f"--month must be YYYY-MM, got {args.month!r}", file=sys.stderr)
        return 2
    month = int(args.month.split("-")[1])

    posts = collect_posts(month, args.max_pages, args.quiet_pages)
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
        print("no posts matched — widen --max-pages or check the month", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
