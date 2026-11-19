import { describe, expect, it } from '@jest/globals';
import { productMetaDescription } from '@/features/products/productPageHelpers';

describe('productMetaDescription', () => {
  it('uses the product description, cut to a search-snippet length', () => {
    expect(productMetaDescription({ description: `  ${'a'.repeat(200)}  ` })).toBe('a'.repeat(155));
  });

  it('falls back to a generic line without a description', () => {
    expect(productMetaDescription({ description: ' ' })).toContain('R9lab');
    expect(productMetaDescription({})).toContain('R9lab');
  });
});
