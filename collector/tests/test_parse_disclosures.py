"""Stage 2's shared-receipt split.

A 사용처 cell naming two shops used to be dropped whole, one visit at a time.
It is split here rather than in stage 3 because ``build_places.py`` joins a
transaction to a place through that raw string: once it is a join key, only one
of the two shops can ever be reached.

The direction that matters is *not inflating*. A split that hands each named
venue the full receipt would make a shared bill look like two full visits worth
of money, and money is the rank tiebreaker — so the unnamed "외 N곳" venues keep
counting toward the divisor even though they publish nothing.
"""

from __future__ import annotations

from collector.tests.skill_scripts import load_skill_script

pd = load_skill_script("parse_disclosures")


def test_single_venue_is_returned_untouched():
    assert pd.split_venues("까망염소", 12000) == [("까망염소", 12000)]


def test_comma_row_becomes_one_visit_per_named_venue():
    assert pd.split_venues("산하춘, 카페에바나나", 80000) == [
        ("산하춘", 40000), ("카페에바나나", 40000)]


def test_slash_and_및_separate_venues_too():
    assert pd.split_venues("소복소복 / 산하춘 및 숲", 90000) == [
        ("소복소복", 30000), ("산하춘", 30000), ("숲", 30000)]


def test_unnamed_venues_take_their_share_out_with_them():
    # "외 1곳" is a second venue nothing names: 소복소복 gets half, not all of it.
    assert pd.split_venues("소복소복 외 1곳", 60000) == [("소복소복", 30000)]
    assert pd.split_venues("소복소복 외 3곳", 60000) == [("소복소복", 15000)]


def test_row_naming_no_venue_at_all_is_dropped():
    assert pd.split_venues("외 2곳", 50000) == []


def test_remainder_is_dropped_rather_than_handed_to_a_venue():
    # 3 ways of 100 is 33 each; the leftover won belongs to no venue.
    assert pd.split_venues("가, 나, 다", 100) == [("가", 33), ("나", 33), ("다", 33)]
