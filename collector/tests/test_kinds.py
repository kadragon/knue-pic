"""What ``derive_kind`` must never do: read only the first segment, or let a café rank as a
restaurant.

Every path below is a real value from the approved rows of ``review_candidates.csv``. The three
that matter most share the same first segment — `음식점` — and land in three different buckets,
which is the whole reason the published ``category`` cannot answer this question.
"""

from __future__ import annotations

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
