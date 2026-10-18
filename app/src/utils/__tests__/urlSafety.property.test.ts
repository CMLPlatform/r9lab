import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';
import { isPrivateLocalHost, normalizeHttpUrl, stripTrailingSlash } from '@/utils/urlSafety';

describe('urlSafety properties', () => {
  it('stripTrailingSlash removes only trailing slashes and is idempotent', () => {
    fc.assert(
      fc.property(fc.string(), fc.nat({ max: 5 }), (value, slashes) => {
        const stripped = stripTrailingSlash(value + '/'.repeat(slashes));
        expect(stripped.endsWith('/')).toBe(false);
        expect(value.startsWith(stripped)).toBe(true);
        expect(stripTrailingSlash(stripped)).toBe(stripped);
      }),
    );
  });

  it('normalizeHttpUrl is idempotent and keeps an http(s) URL', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.webUrl({ withQueryParameters: true, withFragments: true }), fc.string()),
        (value) => {
          const normalized = normalizeHttpUrl(value);
          if (normalized === undefined) return;
          expect(normalizeHttpUrl(normalized)).toBe(normalized);
          expect(['http:', 'https:']).toContain(new URL(normalized).protocol);
        },
      ),
    );
  });

  it('isPrivateLocalHost ignores case', () => {
    fc.assert(
      fc.property(fc.oneof(fc.domain(), fc.ipV4(), fc.string()), (host) => {
        expect(isPrivateLocalHost(host.toUpperCase())).toBe(isPrivateLocalHost(host.toLowerCase()));
      }),
    );
  });

  it('isPrivateLocalHost accepts every address in the private IPv4 ranges', () => {
    const octet = fc.integer({ min: 0, max: 255 });
    const privateIpV4 = fc.oneof(
      fc.tuple(fc.constant(10), octet, octet, octet),
      fc.tuple(fc.constant(127), octet, octet, octet),
      fc.tuple(fc.constant(192), fc.constant(168), octet, octet),
      fc.tuple(fc.constant(172), fc.integer({ min: 16, max: 31 }), octet, octet),
      fc.tuple(fc.constant(169), fc.constant(254), octet, octet),
    );
    fc.assert(
      fc.property(privateIpV4, (octets) => {
        expect(isPrivateLocalHost(octets.join('.'))).toBe(true);
      }),
    );
  });

  it('isPrivateLocalHost rejects a private address used as a subdomain of a public host', () => {
    fc.assert(
      fc.property(fc.ipV4(), fc.domain(), (ip, domain) => {
        fc.pre(!domain.endsWith('.local'));
        expect(isPrivateLocalHost(`${ip}.${domain}`)).toBe(false);
      }),
    );
  });
});
