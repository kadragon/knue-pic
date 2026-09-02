#!/usr/bin/env python3
"""Stage 4 — look each venue up and append it to the review queue.

Usage:
    NAVER_SEARCH_CLIENT_ID=... NAVER_SEARCH_CLIENT_SECRET=... \
      python3 geocode_candidates.py --month 2026-07 [--out-dir collector/out]
                                    [--csv review_candidates.csv]
    python3 geocode_candidates.py --selftest      # verify the API and the
                                                  # coordinate scale first
    python3 geocode_candidates.py --report        # list same-coordinate name
                                                  # clusters to consider merging

Every row is written with status=pending. The geocoder never promotes a place:
docs/architecture.md makes review_candidates.csv the human gate, and a
plausible-looking single hit is exactly the case that gate exists to catch.

A row already in the CSV keeps its status and any reviewer edits; only its
visit count and month list are refreshed, so re-running a month never discards
a review decision but recurring venues still show real totals.
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


MAX_RATE_LIMIT_RETRIES = 5


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


def search(query: str, client_id: str, secret: str, display: int = 5,
           rate_limit_tries: int = 0, network_tries: int = 0) -> list[dict]:
    """Query the active backend, picking one on the first call."""
    global _active
    order = [_active] if _active else list(BACKENDS)
    last: Exception | None = None
    for backend in order:
        try:
            items = _call(backend, query, client_id, secret, display)
        except urllib.error.HTTPError as exc:
            if exc.code == 429:
                # Bounded: an endpoint that answers 429 forever would otherwise
                # recurse until RecursionError, losing the whole run's work.
                if rate_limit_tries >= MAX_RATE_LIMIT_RETRIES:
                    raise
                time.sleep(2.0 * (rate_limit_tries + 1))
                return search(query, client_id, secret, display,
                              rate_limit_tries + 1, network_tries)
            # 401/403/404 means these credentials belong to the other gateway.
            if exc.code in (401, 403, 404) and _active is None:
                last = exc
                continue
            raise
        except urllib.error.URLError as exc:
            if _active is None:
                last = exc
                continue
            if network_tries >= 2:
                raise
            time.sleep(1.0 + network_tries)
            return search(query, client_id, secret, display,
                          rate_limit_tries, network_tries + 1)
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


def region_of(item: dict, only: str | None = None) -> tuple[bool, str]:
    """Which of the in-scope regions this hit sits in.

    `only` narrows the test to one region. Accepting any of the four when the
    query named 청주 lets a 대전 shop of the same name win, which is the very
    mislocation the region-qualified query exists to prevent.
    """
    text = f"{item.get('address', '')} {item.get('roadAddress', '')}"
    for region in ((only,) if only else REGIONS):
        if region and region in text:
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
        in_region = [item for item in items if region_of(item, region)[0]]
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


def load_existing(path: str) -> tuple[list[dict], list[str]]:
    """Return the existing rows and the full column list, ours plus theirs.

    Reviewers annotate this file by hand. Projecting it back through FIELDS
    alone would silently delete any column they added.
    """
    if not os.path.exists(path):
        return [], list(FIELDS)
    with open(path, encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh)
        rows = list(reader)
        found = list(reader.fieldnames or [])
    columns = list(FIELDS) + [name for name in found if name not in FIELDS]
    return rows, columns


def coordinate_clusters(rows: list[dict]) -> list[tuple[str, list[dict]]]:
    """Group approved rows on identical lat/lng and keep the groups holding ≥2 names.

    Two approved rows sharing a coordinate to the digit are one business under two
    spellings — the geocoder resolved both to the same place. That is the signal
    `collector/aliases.json` is built from, and finding it by eye over ~900 rows is
    the manual pass this exists to remove. It only *proposes*: merging stays a
    reviewer decision, because a mall food court really can hold two businesses at
    one point.
    """
    groups: dict[str, list[dict]] = {}
    for row in rows:
        if (row.get("status") or "").strip() != "approved":
            continue
        lat, lng = (row.get("lat") or "").strip(), (row.get("lng") or "").strip()
        if not lat or not lng:
            continue
        groups.setdefault(f"{lat},{lng}", []).append(row)

    clusters = [
        (key, members)
        for key, members in groups.items()
        if len({(m.get("canonical_name") or "").strip() for m in members}) > 1
    ]
    # Loudest first: a cluster's visit total is what decides whether merging it
    # changes the ranking a reader sees.
    clusters.sort(key=lambda item: -sum(_visits(m) for m in item[1]))
    return clusters


def _visits(row: dict) -> int:
    try:
        return int((row.get("visits") or "0").strip() or 0)
    except ValueError:
        return 0


def report(csv_path: str, aliases_path: str) -> int:
    # Operator error ends the same way whichever path it arrives on — a line on
    # stderr and exit 2. A mistyped path is the ordinary way to run this flag
    # wrong, and a traceback tells the operator about json/open rather than
    # about the argument they got wrong.
    if os.path.isdir(csv_path):
        print(f"{csv_path} is a directory — --csv takes the review queue file",
              file=sys.stderr)
        return 2
    if not os.path.isfile(csv_path):
        print(f"{csv_path} does not exist — run stage 4 first", file=sys.stderr)
        return 2
    rows, _ = load_existing(csv_path)
    clusters = coordinate_clusters(rows)

    aliases: dict[str, str] = {}
    if os.path.exists(aliases_path):
        # An unreadable map stops the run instead of falling back to {}: --report
        # reads it to decide which clusters are already settled, so an empty map
        # would re-propose every merge the reviewer has already made.
        try:
            with open(aliases_path, encoding="utf-8") as fh:
                loaded = json.load(fh)
        except (OSError, json.JSONDecodeError) as exc:
            print(f"{aliases_path} could not be read as JSON ({exc}) — fix it or pass\n"
                  "--aliases with the right path", file=sys.stderr)
            return 2
        if not isinstance(loaded, dict):
            print(f"{aliases_path} is not a JSON object — --aliases takes a "
                  '{"spelling": "canonical name"} map', file=sys.stderr)
            return 2
        aliases = loaded

    if not clusters:
        print(f"No same-coordinate clusters among the approved rows in {csv_path}.")
        return 0

    targets = set(aliases.values())

    def state_of(name: str) -> str:
        # A name already in aliases.json is not a decision to re-make every month,
        # and neither is the name the others already merge *into*.
        if name in aliases:
            return f"→ {aliases[name]}"
        return "canonical" if name in targets else "unmapped"

    def names_of(members: list[dict]) -> list[str]:
        return [(m.get("canonical_name") or "").strip() for m in members]

    # A cluster is settled when its spellings all resolve to ONE canonical name.
    # "Every name is mapped somewhere" is the weaker test and hides a real case:
    # aliases {"A": "C", "X": "B"} leaves A and B at one coordinate publishing as two
    # places, with nothing unmapped to notice. Printing settled clusters is what made
    # the manual pass tiring, so they collapse to a count and only open ones get a block.
    open_clusters = [
        (key, members) for key, members in clusters
        if len({aliases.get(name, name) for name in names_of(members)}) > 1
    ]
    settled = len(clusters) - len(open_clusters)

    if not open_clusters:
        print(f"{len(clusters)} same-coordinate cluster(s) in {csv_path}, "
              f"all already merged in {aliases_path} — nothing to decide.")
        return 0

    open_visits = sum(_visits(m) for _, members in open_clusters for m in members)
    print(f"{len(open_clusters)} same-coordinate cluster(s) awaiting a merge decision "
          f"in {csv_path}, {open_visits} visits.\n"
          "Each block is one coordinate: these spellings geocoded to the same point.\n"
          f"Consider mapping them onto one canonical name in {aliases_path} —\n"
          "this proposes, it never merges.\n")

    for key, members in open_clusters:
        members = sorted(members, key=lambda m: -_visits(m))
        head = members[0]
        label = (head.get("naver_title") or head.get("display_name") or "").strip()
        print(f"  {key}  {label}  ({sum(_visits(m) for m in members)} visits)")
        for member in members:
            name = (member.get("canonical_name") or "").strip()
            # Padding is deliberately absent — these names are CJK, so it never lines up.
            print(f"      {name} ({_visits(member)} visits) — {state_of(name)}")
        print()

    if settled:
        print(f"({settled} further cluster(s) are already fully merged — not listed.)")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--month", help="target month, YYYY-MM")
    ap.add_argument("--out-dir", default="collector/out")
    ap.add_argument("--csv", default="review_candidates.csv")
    ap.add_argument("--selftest", action="store_true",
                    help="check credentials and the coordinate scale, then exit")
    ap.add_argument("--report", action="store_true",
                    help="list approved rows sharing a coordinate — the merge "
                         "candidates for collector/aliases.json — then exit")
    ap.add_argument("--aliases", default="collector/aliases.json",
                    help="alias map consulted by --report to mark a name already merged")
    args = ap.parse_args()

    if args.selftest:
        return selftest()
    # Reads the committed queue only: no credentials, no month, no network.
    if args.report:
        return report(args.csv, args.aliases)
    if not args.month or not re.fullmatch(r"\d{4}-\d{2}", args.month):
        print("--month YYYY-MM is required (or use --selftest / --report)", file=sys.stderr)
        return 2

    client_id, secret = credentials()
    root = os.path.join(args.out_dir, args.month)
    with open(os.path.join(root, "normalized_places.json"), encoding="utf-8") as fh:
        places = json.load(fh)["places"]

    existing_rows, columns = load_existing(args.csv)
    by_name = {row.get("canonical_name", ""): row for row in existing_rows}
    new_rows: list[dict] = []
    failures: list[str] = []
    counts = {"updated": 0, "no_hit": 0, "out_of_region": 0, "non_food": 0}

    for place in places:
        seen = by_name.get(place["canonicalName"])
        if seen is not None:
            # Refresh the counts a reviewer uses to judge, but never re-geocode
            # and never touch status or any column they filled in.
            months = [m for m in (seen.get("months") or "").split(";") if m]
            if args.month not in months:
                months.append(args.month)
                seen["months"] = ";".join(sorted(months))
                seen["visits"] = str(int(seen.get("visits") or 0) + place["visits"])
                counts["updated"] += 1
            continue
        try:
            items, query = lookup(place["canonicalName"], client_id, secret)
        except Exception as exc:  # noqa: BLE001
            # One venue's network failure must not throw away the whole run:
            # the CSV is written once, at the end, after ~400 API calls.
            failures.append(f"{place['canonicalName']}: {exc}")
            continue
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

    # Write beside the target and rename: truncating the committed review queue
    # in place would destroy approved/rejected decisions if this crashed midway.
    temp = args.csv + ".tmp"
    with open(temp, "w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        for row in existing_rows:
            writer.writerow({key: row.get(key, "") for key in columns})
        for row in new_rows:
            writer.writerow(row)
    os.replace(temp, args.csv)

    print(f"{args.month}: {len(new_rows)} new pending rows -> {args.csv}")
    print(f"  existing rows updated       : {counts['updated']}")
    print(f"  no geocoding hit            : {counts['no_hit']}")
    print(f"  outside {'/'.join(REGIONS)} : {counts['out_of_region']}")
    print(f"  non-food category           : {counts['non_food']}")
    if failures:
        print(f"  LOOKUP FAILED, not queued   : {len(failures)}")
        for line in failures:
            print(f"      {line}")
    print("\nNew rows are pending. Set status to approved or rejected by hand before"
          "\nbuilding data/places.json — nothing publishes without that pass.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
