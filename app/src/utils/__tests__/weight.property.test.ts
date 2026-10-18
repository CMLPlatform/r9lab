import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';
import { formatWeightKg } from '@/utils/weight';

const GRAMS_PATTERN = /^(\d+) g$/;
const KG_PATTERN = /^(\d+)\.(\d) kg$/;

describe('formatWeightKg properties', () => {
  // Below 1000 kg, so the en-US formatter adds no thousands separator.
  const weightKg = fc.double({ min: 0, max: 999, noNaN: true });

  it('reads back within rounding of the input weight', () => {
    fc.assert(
      fc.property(weightKg, (kg) => {
        const text = formatWeightKg(kg);
        const grams = GRAMS_PATTERN.exec(text);
        const kilos = KG_PATTERN.exec(text);
        if (grams) {
          expect(Number(grams[1])).toBeLessThan(1000);
          expect(Math.abs(Number(grams[1]) / 1000 - kg)).toBeLessThanOrEqual(0.0005);
        } else {
          expect(kilos).not.toBeNull();
          expect(Math.abs(Number(`${kilos?.[1]}.${kilos?.[2]}`) - kg)).toBeLessThanOrEqual(0.0505);
        }
      }),
    );
  });

  it('is monotonic in the displayed value', () => {
    const shown = (kg: number) => {
      const text = formatWeightKg(kg);
      return text.endsWith(' kg') ? Number.parseFloat(text) * 1000 : Number.parseFloat(text);
    };
    fc.assert(
      fc.property(weightKg, weightKg, (a, b) => {
        const [low, high] = a <= b ? [a, b] : [b, a];
        expect(shown(low)).toBeLessThanOrEqual(shown(high));
      }),
    );
  });
});
