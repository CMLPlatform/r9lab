import type { Product, ProductMaterial } from '@/types/Product';

/**
 * A bill of materials may differ from the product's weight by this fraction
 * before we warn. Fasteners, coatings and rounding leave a real gap, so this
 * is a prompt to re-check, never an error.
 */
export const MASS_BALANCE_TOLERANCE = 0.1;

const GRAMS_PER_UNIT: Partial<Record<ProductMaterial['unit'], number>> = { g: 1, kg: 1000 };

/** Total material mass in grams, or undefined when any row is not a mass (m, cm) or there are no rows. */
export function totalMaterialMassG(materials: ProductMaterial[]): number | undefined {
  if (materials.length === 0) return undefined;
  let total = 0;
  for (const { quantity, unit } of materials) {
    const factor = GRAMS_PER_UNIT[unit];
    if (factor === undefined) return undefined;
    total += quantity * factor;
  }
  return total;
}

/**
 * Non-blocking notes on a saved record's bill of materials. `materials` is the
 * list on screen, which in edit mode is fresher than `product.materials`.
 */
export function bomWarnings(product: Product, materials: ProductMaterial[]): string[] {
  // A draft is checked after it is saved: components can only be added then.
  if (typeof product.id !== 'number') return [];
  const components = product.components;
  const warnings: string[] = [];

  if (materials.length === 0 && components?.length === 0) {
    warnings.push('Add materials or components: a record needs at least one of them.');
  }

  const total = totalMaterialMassG(materials);
  const weight = product.physicalProperties.weight;
  // With components the weight includes theirs, so this record's own rows cannot be compared to it.
  if (total !== undefined && weight && components?.length === 0) {
    const gap = Math.abs(total - weight) / weight;
    if (gap > MASS_BALANCE_TOLERANCE) {
      warnings.push(
        `Materials add up to ${formatGrams(total)}, but the weight is ${formatGrams(weight)}. They differ by more than ${MASS_BALANCE_TOLERANCE * 100}%.`,
      );
    }
  }
  return warnings;
}

const grams = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
export const formatGrams = (g: number) => `${grams.format(g)} g`;
