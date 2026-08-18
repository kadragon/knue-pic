#!/usr/bin/env python3
"""Stage 4 — look each venue up and append it to the review queue.

Usage:
    NAVER_SEARCH_CLIENT_ID=... NAVER_SEARCH_CLIENT_SECRET=... \
      python3 geocode_candidates.py --month 2026-07 [--out-dir collector/out]
                                    [--csv review_candidates.csv]
    python3 geocode_candidates.py --selftest      # verify the API and the
                                                  # coordinate scale first

Every row is written with status=pending. The geocoder never promotes a place:
docs/architecture.md makes review_candidates.csv the human gate, and a
plausible-looking single hit is exactly the case that gate exists to catch.

Rows whose canonical_name is already in the CSV are left alone, so the file can
be re-run for a month without discarding review decisions already made.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

# The 검색 API moved to NAVER Cloud Platform's NAVER API HUB, which changed both
# the host and the auth header names. Keys issued on the old NAVER Developers
# console are not accepted by the new gateway and vice versa, so rather than
# guess which one the operator holds, try the current path first and fall back.
# --selftest reports which backend actually answered.
BACKENDS = {
    "ncp": {
        "url": "https://naverapihub.apigw.ntruss.com/search/v1/local",
        "id_header": "X-NCP-APIGW-API-KEY-ID",
        "secret_header": "X-NCP-APIGW-API-KEY",
        "extra": {"format": "json"},
    },
    "legacy": {
        "url": "https://openapi.naver.com/v1/search/local.json",
        "id_header": "X-Naver-Client-Id",
        "secret_header": "X-Naver-Client-Secret",
        "extra": {},
    },
}
_active: str | None = None

# Agreed scope: the university's everyday radius, not every business trip.
REGIONS = ("청주", "세종", "공주", "대전")

# Naver returns a taxonomy string whose head term is not stable: the official
# reference shows "한식>육류,고기요리" while live results also carry an "음식점>"
# prefix. So match on any food term anywhere in the string rather than on a
# prefix, and treat the result as a flag for the reviewer, never as a rejection.
FOOD_HINTS = (
    "음식점", "한식", "중식", "일식", "양식", "분식", "뷔페", "치킨", "피자",
    "카페", "커피", "제과", "베이커리", "디저트", "술집", "주점", "호프",
    "고기", "횟집", "해물", "해산물", "생선", "요리", "식당", "국수", "찌개",
    "전통식품", "떡", "food",
)

FIELDS = [
    "status", "canonical_name", "display_name", "raw_names", "months", "visits",
    "naver_title", "category", "address", "road_address", "lat", "lng",
    "candidate_count", "region_ok", "category_ok", "query", "note",
]

_TAG = re.compile(r"<[^>]+>")


def credentials() -> tuple[str, str]:
    client_id = os.environ.get("NAVER_SEARCH_CLIENT_ID", "")
    secret = os.environ.get("NAVER_SEARCH_CLIENT_SECRET", "")
    if not client_id or not secret:
        raise SystemExit(
            "NAVER_SEARCH_CLIENT_ID / NAVER_SEARCH_CLIENT_SECRET must be set in the\n"
            "environment. They are the collector's server credentials and must never\n"
            "reach src/, a committed file, or an Actions secret used by the web build."
        )
    return client_id, secret


def _call(backend: str, query: str, client_id: str, secret: str, display: int) -> list[dict]:
    spec = BACKENDS[backend]
    params = {"query": query, "display": display, **spec["extra"]}
    url = spec["url"] + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={
        spec["id_header"]: client_id,
        spec["secret_header"]: secret,
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    time.sleep(0.15)
    return payload.get("items", [])


def search(query: str, client_id: str, secret: str, display: int = 5) -> list[dict]:
    """Query the active backend, picking one on the first call."""
    global _active
    order = [_active] if _active else list(BACKENDS)
    last: Exception | None = None
    for backend in order:
        try:
            items = _call(backend, query, client_id, secret, display)
        except urllib.error.HTTPError as exc:
            if exc.code == 429:
                time.sleep(2.0)
                return search(query, client_id, secret, display)
            # 401/403/404 means these credentials belong to the other gateway.
            if exc.code in (401, 403, 404) and _active is None:
                last = exc
                continue
            raise
        except urllib.error.URLError as exc:
            if _active is None:
                last = exc
                continue
            raise
        _active = backend
        return items
    raise SystemExit(
        "Neither NAVER API HUB nor the legacy openapi.naver.com endpoint accepted these\n"
        f"credentials (last error: {last}). Check which console issued the key."
    )


def active_backend() -> str:
    return _active or "(none yet)"


def to_degrees(value) -> float | None:
    """Convert a mapx/mapy field to degrees.

    The API has shipped more than one coordinate convention, so rather than
    hardcode a divisor this picks the scale that lands the value in a plausible
    Korean range. --selftest checks the result against a known location before
    a real run trusts it.
    """
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    for divisor in (1.0, 1e7, 1e6):
        scaled = number / divisor
        if 33.0 <= scaled <= 39.5 or 124.0 <= scaled <= 132.0:
            return round(scaled, 7)
    return None


def region_of(item: dict) -> tuple[bool, str]:
    text = f"{item.get('address', '')} {item.get('roadAddress', '')}"
    for region in REGIONS:
        if region in text:
            return True, region
    return False, ""


def is_food(category: str) -> bool:
    lowered = category.lower()
    return any(hint in lowered for hint in FOOD_HINTS)


def lookup(name: str, client_id: str, secret: str) -> tuple[list[dict], str]:
    """Region-qualified queries first, bare name only as a fallback.

    The API has no location bias, so a bare "만리장성" resolves to the Seoul
    restaurant of that name and a real 청주 venue looks out of scope. Asking
    region by region and keeping the first in-region hit fixes the answer
    rather than just the flag.
    """
    for region in REGIONS:
        query = f"{region} {name}"
        items = search(query, client_id, secret)
        in_region = [item for item in items if region_of(item)[0]]
        if in_region:
            return in_region, query
    items = search(name, client_id, secret)
    return items, name


def selftest() -> int:
    client_id, secret = credentials()
    items = search("한국교원대학교", client_id, secret)
    if not items:
        print("selftest FAILED: the API returned no result for 한국교원대학교",
              file=sys.stderr)
        return 1
    top = items[0]
    lat, lng = to_degrees(top.get("mapy")), to_degrees(top.get("mapx"))
    print(f"backend={active_backend()}")
    print(f"title={_TAG.sub('', top.get('title', ''))} category={top.get('category')}")
    print(f"address={top.get('address')}")
    print(f"raw mapx={top.get('mapx')} mapy={top.get('mapy')} -> lat={lat} lng={lng}")
    # KNUE sits in 청주 흥덕구 강내면, near 36.6N 127.3E.
    if lat is None or lng is None or not (36.3 <= lat <= 36.9 and 127.0 <= lng <= 127.6):
        print("selftest FAILED: coordinates are not near the campus — the mapx/mapy\n"
              "convention changed. Fix to_degrees() before trusting a real run.",
              file=sys.stderr)
        return 1
    print("selftest OK: credentials work and the coordinate scale is right.")
    return 0


def load_existing(path: str) -> tuple[list[dict], set[str]]:
    if not os.path.exists(path):
        return [], set()
    with open(path, encoding="utf-8", newline="") as fh:
        rows = list(csv.DictReader(fh))
    return rows, {row.get("canonical_name", "") for row in rows}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--month", help="target month, YYYY-MM")
    ap.add_argument("--out-dir", default="collector/out")
    ap.add_argument("--csv", default="review_candidates.csv")
    ap.add_argument("--selftest", action="store_true",
                    help="check credentials and the coordinate scale, then exit")
    args = ap.parse_args()

    if args.selftest:
        return selftest()
    if not args.month or not re.fullmatch(r"\d{4}-\d{2}", args.month):
        print("--month YYYY-MM is required (or use --selftest)", file=sys.stderr)
        return 2

    client_id, secret = credentials()
    root = os.path.join(args.out_dir, args.month)
    with open(os.path.join(root, "normalized_places.json"), encoding="utf-8") as fh:
        places = json.load(fh)["places"]

    existing_rows, known = load_existing(args.csv)
    new_rows: list[dict] = []
    counts = {"already_queued": 0, "no_hit": 0, "out_of_region": 0, "non_food": 0}

    for place in places:
        if place["canonicalName"] in known:
            counts["already_queued"] += 1
            continue
        items, query = lookup(place["canonicalName"], client_id, secret)
        notes: list[str] = []
        row = {
            "status": "pending",
            "canonical_name": place["canonicalName"],
            "display_name": place["displayName"],
            "raw_names": " | ".join(place["rawNames"]),
            "months": args.month,
            "visits": place["visits"],
            "query": query,
            "candidate_count": len(items),
            "naver_title": "", "category": "", "address": "", "road_address": "",
            "lat": "", "lng": "", "region_ok": "", "category_ok": "", "note": "",
        }
        if not items:
            counts["no_hit"] += 1
            notes.append("no geocoding hit")
            # 소재지 is published by one department only, but when it is there it
            # is the best clue a reviewer has.
            if place["addresses"]:
                notes.append("disclosed 소재지: " + " / ".join(place["addresses"]))
        else:
            top = items[0]
            in_region, matched = region_of(top)
            food = is_food(top.get("category", ""))
            row.update({
                "naver_title": _TAG.sub("", top.get("title", "")),
                "category": top.get("category", ""),
                "address": top.get("address", ""),
                "road_address": top.get("roadAddress", ""),
                "lat": to_degrees(top.get("mapy")) or "",
                "lng": to_degrees(top.get("mapx")) or "",
                "region_ok": "yes" if in_region else "no",
                "category_ok": "yes" if food else "no",
            })
            if not in_region:
                counts["out_of_region"] += 1
                notes.append(f"outside {'/'.join(REGIONS)}")
            else:
                notes.append(f"region={matched}")
            if not food:
                counts["non_food"] += 1
                notes.append("category is not food/beverage")
            if len(items) > 1:
                others = ", ".join(_TAG.sub("", i.get("title", "")) for i in items[1:4])
                notes.append(f"other candidates: {others}")
        row["note"] = "; ".join(notes)
        new_rows.append(row)

    with open(args.csv, "w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=FIELDS)
        writer.writeheader()
        for row in existing_rows:
            writer.writerow({key: row.get(key, "") for key in FIELDS})
        for row in new_rows:
            writer.writerow(row)

    print(f"{args.month}: {len(new_rows)} new pending rows -> {args.csv}")
    print(f"  already in the queue        : {counts['already_queued']}")
    print(f"  no geocoding hit            : {counts['no_hit']}")
    print(f"  outside {'/'.join(REGIONS)} : {counts['out_of_region']}")
    print(f"  non-food category           : {counts['non_food']}")
    print("\nEvery row is pending. Set status to approved or rejected by hand before"
          "\nbuilding data/places.json — nothing publishes without that pass.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
