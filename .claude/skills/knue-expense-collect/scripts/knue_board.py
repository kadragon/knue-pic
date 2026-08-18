"""Shared helpers for reading the KNUE 청렴정보 disclosure board.

Stdlib only on purpose: the operator's machine is not guaranteed to have
requests/bs4, and this collector must stay runnable from a clean checkout.
"""

from __future__ import annotations

import html
import re
import time
import urllib.parse
import urllib.request

BASE = "https://www.knue.ac.kr/www/"
BBS_NO = 18
KEY = 786
UA = "Mozilla/5.0 (compatible; knue-pick-collector/1.0)"

# The board renders detail links as ...nttNo=83626&pageIndex=2 from page 2 on,
# so anchoring the pattern on a closing quote silently loses every later page.
_ROW = re.compile(r'nttNo=(\d+)[^>]*>(.*?)</a>', re.S)
_TAG = re.compile(r"<[^>]+>")


def fetch(url: str, retries: int = 3, pause: float = 0.3) -> bytes:
    last: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = resp.read()
            time.sleep(pause)
            return data
        except Exception as exc:  # noqa: BLE001 - network flake, retry
            last = exc
            time.sleep(1.0 + attempt)
    raise RuntimeError(f"fetch failed after {retries} tries: {url}") from last


def fetch_text(url: str) -> str:
    return fetch(url).decode("utf-8", "replace")


def list_url(page: int, keyword: str | None = None) -> str:
    params: dict[str, object] = {"bbsNo": BBS_NO, "key": KEY, "pageIndex": page}
    if keyword:
        params["searchCnd"] = "SJ"
        params["searchKrwd"] = keyword
    return BASE + "selectBbsNttList.do?" + urllib.parse.urlencode(params)


def view_url(ntt_no: str) -> str:
    return BASE + f"selectBbsNttView.do?key={KEY}&bbsNo={BBS_NO}&nttNo={ntt_no}"


def download_url(atch_no: str) -> str:
    return BASE + f"downloadBbsFile.do?atchmnflNo={atch_no}"


def plain(fragment: str) -> str:
    text = html.unescape(_TAG.sub(" ", fragment))
    return " ".join(text.split()).replace("새글", "").strip()


def parse_rows(page_html: str) -> list[tuple[str, str]]:
    """Return (nttNo, title) for every row on a list/search page."""
    seen: dict[str, str] = {}
    for ntt_no, raw in _ROW.findall(page_html):
        title = plain(raw)
        if title:
            seen.setdefault(ntt_no, title)
    return list(seen.items())


def attachments(ntt_no: str) -> list[str]:
    page = fetch_text(view_url(ntt_no))
    found = re.findall(r"downloadBbsFile\.do\?atchmnflNo=(\d+)", page)
    return list(dict.fromkeys(found))


def download_attachment(atch_no: str) -> tuple[str, bytes]:
    """Return (original filename, bytes) for an attachment."""
    req = urllib.request.Request(download_url(atch_no), headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as resp:
        disposition = resp.headers.get("Content-Disposition", "")
        data = resp.read()
    name = ""
    if "filename=" in disposition:
        name = urllib.parse.unquote(disposition.split("filename=", 1)[1].strip().strip('"'))
    time.sleep(0.3)
    return (name or f"{atch_no}.bin"), data


# --- title parsing -----------------------------------------------------------

_DEPT = re.compile(r"^\[\s*([^\]]+?)\s*\]")


def department(title: str) -> str:
    hit = _DEPT.match(title)
    if hit:
        return hit.group(1).strip()
    # A few posts omit the bracket; fall back to the text before the first digit.
    return title.split("20")[0].strip(" []") or title.strip()


def title_months(title: str) -> set[tuple[int, int]]:
    """Best-effort (year, month) set from a post title.

    Titles are unreliable — one 2026-07 post is titled "2025년 7월" — so this is
    only used to decide which posts are worth downloading. The authoritative
    month always comes from the date cells inside the attachment.
    """
    body = _DEPT.sub("", title)
    months: set[tuple[int, int]] = set()
    # The tail is greedy so that "2026년 2월~6월" yields the whole range rather
    # than stopping at the first 월.
    pattern = r"(?:(\d{4})|'?(\d{2}))\s*(?:년|\.)\s*([0-9,~\-\s월]*\d)\s*월"
    for chunk in re.finditer(pattern, body):
        y4, y2, tail = chunk.groups()
        year = int(y4) if y4 else 2000 + int(y2)
        nums = [int(n) for n in re.findall(r"\d{1,2}", tail)]
        if not nums:
            continue
        if re.search(r"[~\-]", tail) and len(nums) >= 2:
            lo, hi = min(nums), max(nums)
            nums = list(range(lo, hi + 1))
        for m in nums:
            if 1 <= m <= 12:
                months.add((year, m))
    return months
