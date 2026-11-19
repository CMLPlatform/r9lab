"""CPV parent rule: divisions are top-level, deeper codes hang under the nearest present ancestor."""

import pytest

from scripts.seed.taxonomies.cpv import get_cpv_parent_id

AVAILABLE = {"30000000", "31000000", "33000000", "30100000", "31100000", "31110000", "03000000"}


@pytest.mark.parametrize("division", ["03000000", "30000000", "31000000", "33000000"])
def test_divisions_have_no_parent(division: str) -> None:
    """Division 31 is a sibling of 30, not a child of it."""
    assert get_cpv_parent_id({"external_id": division}, AVAILABLE) is None


@pytest.mark.parametrize(
    ("code", "parent"),
    [("30100000", "30000000"), ("31100000", "31000000"), ("31110000", "31100000"), ("31111000", "31110000")],
)
def test_deeper_codes_hang_under_their_nearest_present_ancestor(code: str, parent: str) -> None:
    """A missing intermediate level is skipped, a present one is used."""
    assert get_cpv_parent_id({"external_id": code}, AVAILABLE) == parent
