import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';
import { normalizeTotpCode } from '@/utils/totp';

const DIGITS_ONLY_PATTERN = /^\d{0,6}$/;

describe('normalizeTotpCode properties', () => {
  it('yields at most six digits and is idempotent', () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        const code = normalizeTotpCode(value);
        expect(code).toMatch(DIGITS_ONLY_PATTERN);
        expect(normalizeTotpCode(code)).toBe(code);
      }),
    );
  });

  it('keeps a six-digit code typed with separators', () => {
    const digit = fc.constantFrom(...'0123456789');
    fc.assert(
      fc.property(
        fc.array(digit, { minLength: 6, maxLength: 6 }),
        fc.constantFrom(' ', '-', ' ', ''),
        (digits, separator) => {
          const typed = `${digits.slice(0, 3).join('')}${separator}${digits.slice(3).join('')}`;
          expect(normalizeTotpCode(typed)).toBe(digits.join(''));
        },
      ),
    );
  });
});
