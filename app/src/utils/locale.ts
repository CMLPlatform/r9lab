/** Locale helpers for number entry. */

/**
 * The decimal separator for a locale tag, defaulting to the user's.
 *
 * A malformed tag (`de-DE@posix` from some Linux browsers) throws a RangeError. The part before the
 * extension is a valid tag carrying the same separator, so try that before assuming a
 * dot: assuming one is wrong in every comma-decimal locale.
 */
export function decimalSeparatorFor(
  tag: string | undefined = typeof navigator !== 'undefined' ? navigator.language : undefined,
): string {
  for (const candidate of [tag, tag?.split('@')[0], undefined]) {
    try {
      return (1.1).toLocaleString(candidate).charAt(1); // The character between 1 and 1
    } catch {
      // Unusable tag; fall through to the next candidate.
    }
  }
  return '.';
}

/** The number in text typed with `separator` as decimal mark, or undefined for empty or unparseable text. */
export function parseLocalizedFloat(text: string, separator: string): number | undefined {
  if (text.trim() === '') return undefined;
  const value = parseFloat(separator === '.' ? text : text.replace(separator, '.'));
  return Number.isNaN(value) ? undefined : value;
}
