import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';
import { normalizeProductsParams } from '@/features/products/screenData';
import { FILTER_CSV_SEPARATOR } from '@/services/api/products';

// Free user text that may hold commas, but not the separator control character.
const filterValue = fc
  .string({ minLength: 1 })
  .filter((value) => !value.includes(FILTER_CSV_SEPARATOR));

describe('normalizeProductsParams properties', () => {
  it('round-trips brand and type filters joined with the API separator', () => {
    fc.assert(
      fc.property(fc.array(filterValue), fc.array(filterValue), (brands, types) => {
        const params = normalizeProductsParams({
          brands: brands.length ? brands.join(FILTER_CSV_SEPARATOR) : undefined,
          types: types.length ? types.join(FILTER_CSV_SEPARATOR) : undefined,
        });
        expect(params.activeBrands).toEqual(brands);
        expect(params.activeProductTypes).toEqual(types);
      }),
    );
  });
});
