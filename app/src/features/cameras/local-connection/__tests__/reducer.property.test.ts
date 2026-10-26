import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';
import { normalizeLocalConnectionUrl } from '@/features/cameras/local-connection/reducer';
import { isPrivateLocalHost } from '@/utils/urlSafety';

const octet = fc.integer({ min: 0, max: 255 });
const localHost = fc.oneof(
  fc.constant('localhost'),
  fc.domain().map((domain) => `${domain}.local`),
  fc.tuple(octet, octet).map(([c, d]) => `192.168.${c}.${d}`),
  fc.tuple(octet, octet, octet).map(([b, c, d]) => `10.${b}.${c}.${d}`),
);
const localUrl = fc
  .tuple(
    fc.constantFrom('http', 'https', 'HTTP'),
    localHost,
    fc.option(fc.integer({ min: 1, max: 65535 }), { nil: undefined }),
    fc.webPath(),
  )
  .map(([scheme, host, port, path]) => `${scheme}://${host}${port ? `:${port}` : ''}${path}`);

function tryNormalize(value: string): string | null {
  try {
    return normalizeLocalConnectionUrl(value);
  } catch {
    return null;
  }
}

describe('normalizeLocalConnectionUrl properties', () => {
  it('accepts any http(s) URL on a local host, idempotently and without a trailing slash', () => {
    fc.assert(
      fc.property(localUrl, (value) => {
        const normalized = normalizeLocalConnectionUrl(value);
        expect(normalized.endsWith('/')).toBe(false);
        expect(normalizeLocalConnectionUrl(normalized)).toBe(normalized);
      }),
    );
  });

  it('never returns a URL whose host is off the local network', () => {
    fc.assert(
      fc.property(fc.oneof(localUrl, fc.webUrl(), fc.string()), (value) => {
        const normalized = tryNormalize(value);
        if (normalized === null) return;
        expect(isPrivateLocalHost(new URL(normalized).hostname)).toBe(true);
      }),
    );
  });
});
