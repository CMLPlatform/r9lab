import { describe, expect, it } from '@jest/globals';
import {
  bomWarnings,
  MASS_BALANCE_TOLERANCE,
  totalMaterialMassG,
} from '@/features/products/materialBalance';
import { baseProduct } from '@/test-utils/index';
import type { ProductMaterial } from '@/types/Product';

const row = (quantity: number, unit: ProductMaterial['unit'], id = 1): ProductMaterial => ({
  materialID: id,
  name: `Material ${id}`,
  quantity,
  unit,
});
const product = (weight: number | undefined) => ({
  ...baseProduct,
  physicalProperties: { ...baseProduct.physicalProperties, weight },
});

describe('totalMaterialMassG', () => {
  it('sums g and kg rows in grams', () => {
    expect(totalMaterialMassG([row(200, 'g'), row(0.5, 'kg', 2)])).toBe(700);
  });

  it('is not derivable with a length row or no rows', () => {
    expect(totalMaterialMassG([row(200, 'g'), row(3, 'm', 2)])).toBeUndefined();
    expect(totalMaterialMassG([])).toBeUndefined();
  });
});

describe('bomWarnings', () => {
  it('asks for materials or components on a saved record with neither', () => {
    expect(bomWarnings(baseProduct, [])).toEqual([
      expect.stringContaining('materials or components'),
    ]);
  });

  it('stays quiet for an unsaved draft and when components are not loaded', () => {
    expect(bomWarnings({ ...baseProduct, id: 'new' as unknown as number }, [])).toEqual([]);
    expect(bomWarnings({ ...baseProduct, components: undefined }, [])).toEqual([]);
  });

  it('accepts a record that has components but no materials', () => {
    const withComponent = { ...baseProduct, components: [{ ...baseProduct, id: 2 }] };
    expect(bomWarnings(withComponent, [])).toEqual([]);
  });

  it('warns when the mass differs from the weight by more than the tolerance', () => {
    const edge = 850 * (1 - MASS_BALANCE_TOLERANCE);
    expect(bomWarnings(product(850), [row(edge, 'g')])).toEqual([]);
    expect(bomWarnings(product(850), [row(edge - 1, 'g')])).toEqual([
      expect.stringContaining('differ by more than 10%'),
    ]);
  });

  it('skips the balance without a weight, a derivable total or on a record with components', () => {
    expect(bomWarnings(product(undefined), [row(1, 'g')])).toEqual([]);
    expect(bomWarnings(product(850), [row(1, 'g'), row(1, 'm', 2)])).toEqual([]);
    const withComponent = { ...product(850), components: [{ ...baseProduct, id: 2 }] };
    expect(bomWarnings(withComponent, [row(1, 'g')])).toEqual([]);
  });
});
