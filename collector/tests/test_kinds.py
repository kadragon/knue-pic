"""What ``derive_kind`` must never do: read only the first segment, or let a café rank as a
restaurant.

Every path below is a real value from the approved rows of ``review_candidates.csv``. The three
that matter most share the same first segment — `음식점` — and land in three different buckets,
which is the whole reason the published ``category`` cannot answer this question.
"""

from __future__ import annotations

import pathlib
import re

import pytest

from collector.kinds import PLACE_KINDS, derive_kind


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        # One first segment, three kinds — the case `category` (its first segment alone) loses.
        ("음식점>도시락,컵밥", "lunchbox"),
        ("음식점>카페,디저트", "cafe"),
        ("음식점>한식", "restaurant"),
        # A café whose path never says `음식점`, and one that says it twice over.
        ("카페,디저트>베이커리", "cafe"),
        ("음식점>카페,디저트>호두과자", "cafe"),
        ("브런치카페", "cafe"),
        # `차,커피` under a shopping segment is still somewhere you drink coffee.
        ("쇼핑,유통>차,커피", "cafe"),
        # Compound leaf segments no closed word list enumerates.
        ("한식>육류,고기요리", "restaurant"),
        ("음식점>일식>초밥,롤", "restaurant"),
        ("분식>떡볶이", "restaurant"),
        # Not a place to go eat: drinking, and the two shop taxonomies the disclosures carry.
        ("술집>이자카야", "other"),
        ("전통식품>떡,한과", "other"),
        ("제조업>떡류제조", "other"),
        # A one-syllable keyword matched as a substring would put all four of these under a kind
        # they have nothing to do with — `차` sits inside three of them, and the café rule is tested
        # before the restaurant one, so nothing downstream could correct it.
        ("술집>포장마차", "other"),
        ("교통시설>주차장", "other"),
        ("교통,운수서비스>전기차충전소", "other"),
        ("자동차>전시,판매", "other"),
        # The same syllables as their own segment still decide the kind.
        ("카페,디저트>차", "cafe"),
        ("음식점>스테이크,립", "restaurant"),
        ("음식점>죽", "restaurant"),
        # A row approved without a usable classification is published, not dropped.
        ("", "other"),
        (None, "other"),
    ],
)
def test_kind_is_derived_from_every_segment(path: str | None, expected: str) -> None:
    assert derive_kind(path) == expected


def test_every_derived_kind_is_publishable() -> None:
    """The loader rejects the whole file over a kind outside the set, so a rule that emits a novel
    string would blank the site rather than mislabel one place."""
    paths = ["음식점>도시락,컵밥", "카페,디저트>차", "한식>냉면", "술집>맥주,호프", ""]
    assert {derive_kind(path) for path in paths} <= set(PLACE_KINDS)


def test_the_browser_and_the_collector_publish_the_same_closed_set() -> None:
    """`src/data/types.ts` holds the loader's copy of `PLACE_KINDS`, and `parsePlace` rejects the
    whole file over a value outside it. A bucket added here and not there passes the gate — check 10
    reads *this* set — ships green, and then blanks the site at load. The two lists are in different
    languages, so this test is the only thing that can hold them equal."""
    types = (pathlib.Path(__file__).resolve().parents[2] / "src" / "data" / "types.ts").read_text(
        encoding="utf-8")
    declared = re.search(r"PLACE_KINDS\s*=\s*\[(.*?)\]", types, re.S)
    assert declared is not None, "src/data/types.ts no longer declares PLACE_KINDS as an array"

    assert tuple(re.findall(r"'([^']+)'", declared.group(1))) == PLACE_KINDS
