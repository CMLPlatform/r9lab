"""The public-profile statistics model.

The numbers are computed on read by data_collection, over the user's products.
"""

from pydantic import BaseModel


class ProfileStatsData(BaseModel):
    """A user's contribution statistics."""

    product_count: int = 0
    total_weight_g: int = 0
    image_count: int = 0
    top_category: str | None = None

    @property
    def total_weight_kg(self) -> float:
        """Return the gram total in kilograms, to the gram (three decimals)."""
        return round(self.total_weight_g / 1000.0, 3)
