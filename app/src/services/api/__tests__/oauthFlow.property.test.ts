import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';
import { parseOAuthCallbackUrl } from '@/services/api/oauthFlow';

describe('parseOAuthCallbackUrl properties', () => {
  it('reads back the status, error and MFA handoff encoded in the fragment', () => {
    fc.assert(
      fc.property(
        fc.webUrl(),
        fc.oneof(fc.constantFrom('success', 'mfa_required', 'error'), fc.string()),
        fc.option(fc.string(), { nil: undefined }),
        fc.option(fc.string(), { nil: undefined }),
        (base, status, error, mfaHandoff) => {
          const fragment = new URLSearchParams({ status });
          if (error !== undefined) fragment.set('error', error);
          if (mfaHandoff !== undefined) fragment.set('mfa_handoff', mfaHandoff);
          const url = new URL(base);
          url.hash = fragment.toString();

          expect(parseOAuthCallbackUrl(url.toString())).toEqual({
            status: status === 'success' || status === 'mfa_required' ? status : 'error',
            error,
            mfaHandoff,
          });
        },
      ),
    );
  });

  it('never throws on arbitrary input', () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        expect(() => parseOAuthCallbackUrl(value)).not.toThrow();
      }),
    );
  });
});
