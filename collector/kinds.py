"""The coarse venue kind published as ``places[].kind``, derived from Naver's taxonomy path.

``category`` is the path's first segment and stays vendor free text — 105 distinct values across
the approved queue, `음식점` alone covering 189 published places. That is the wrong granularity for
"show me only the cafés": the segment `음식점` swallows restaurants, cafés and lunchbox shops
alike, while cafés arrive spelled three different ways (`카페,디저트`, `음식점>카페,디저트`,
`브런치카페`). The full path separates them and only the CSV keeps it, so the split has to be made
here, at build time — the browser sees the truncated value and cannot redo this.

Unlike ``category`` the values are English slugs, because this is a closed enum the code owns
rather than text the vendor supplies: `src/data/load.ts` rejects a file carrying anything outside
``PLACE_KINDS``, and the Korean labels live in `src/ui/kind-filter.ts` where every other
user-facing string does.
"""

from __future__ import annotations

import re

# The published set, in the order the UI lists them. `src/data/types.ts` -> `PLACE_KINDS` is the
# browser-side copy; the validator checks membership so the two can never silently diverge.
PLACE_KINDS = ("restaurant", "cafe", "lunchbox", "other")

# The kind for a row whose path matches no rule, and for the classified-but-uncategorized row the
# build publishes as `기타`. Never a dropped place: it is approved, so a human placed it on the map.
UNCLASSIFIED_KIND = "other"

# Matched against every segment of the path, not just the first. Order is the rule, not a detail:
# `음식점>도시락,컵밥` is a lunchbox shop and `음식점>카페,디저트` a café, so both have to be
# decided before the `음식점` segment can claim them as a restaurant.
#
# `other` has no entry — it is what a path falls through to, and it is where the non-eatery
# segments the disclosures carry (`술집`, `전통식품`, `제조업`, `쇼핑,유통`) land on purpose: the
# page is about where staff ate, and a distillery is not a place to go eat.
_RULES: tuple[tuple[str, frozenset[str]], ...] = (
    ("lunchbox", frozenset({"도시락", "컵밥"})),
    ("cafe", frozenset({
        "카페", "디저트", "베이커리", "차", "아이스크림", "케이크전문", "호두과자", "떡카페",
        "브런치", "브런치카페", "빵",
    })),
    ("restaurant", frozenset({
        "음식점", "한식", "양식", "중식", "일식", "분식", "치킨", "닭강정", "피자", "햄버거",
        "샌드위치", "토스트", "뷔페", "육류", "고기요리", "해물", "생선요리", "죽", "국밥",
        "칼국수", "만두", "찌개", "전골", "면요리", "아시아음식", "베트남음식", "프랑스음식",
        "이탈리아음식", "스테이크", "립", "패밀리레스토랑", "한식뷔페",
    })),
)

# `>` nests the taxonomy and `,` joins two names for one level (`카페,디저트`); both are separators
# for this purpose, since a match on either half decides the same kind.
_SEPARATORS = re.compile(r"[>,]")


def _matches(segment: str, keyword: str) -> bool:
    """Substring for a compound keyword, whole-segment for a one-syllable one.

    The compounds have to match loosely: the queue carries leaf segments no closed list can
    enumerate (`카페,디저트>케이크전문`, `음식점>일식>초밥,롤`), and a segment containing `카페` is a
    café whatever else it says. A single syllable cannot be matched that way — `차` is inside
    `포장마차`, `주차장` and `전기차충전소`, none of which is a café, and because the café rule is
    tested before the restaurant one nothing downstream could correct it. Same shape for `립` and
    `죽`, which sit inside ordinary words.
    """
    return segment == keyword if len(keyword) == 1 else keyword in segment


def derive_kind(category_path: str | None) -> str:
    """The kind ``category_path`` denotes, or ``other``.

    ``category_path`` is the raw CSV value — the whole path, not the truncated ``category`` the
    dataset publishes. How a keyword is matched depends on its length — see ``_matches``.
    """
    if not category_path:
        return UNCLASSIFIED_KIND

    segments = [segment.strip() for segment in _SEPARATORS.split(category_path)]
    for kind, keywords in _RULES:
        if any(_matches(segment, keyword) for segment in segments for keyword in keywords):
            return kind
    return UNCLASSIFIED_KIND
