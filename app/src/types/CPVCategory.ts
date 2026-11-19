/** One row of the category picker: a CPV category, or a product type shown the same way. */
export type CPVCategory = {
  id: number;
  /** The stored product type name (`CPV: <code>`). */
  name: string;
  /** The human label. */
  description: string;
  /** Direct subcategories to browse into; 0 for a leaf or a product type. */
  childCount: number;
};
