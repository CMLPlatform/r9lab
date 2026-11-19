import { afterEach, describe, expect, it } from '@jest/globals';
import { HttpResponse, http } from 'msw';
import { API_URL } from '@/config';
import { authRuntime } from '@/services/api/auth/authRuntime';
import { getRevisions } from '@/services/api/products';
import { server } from '@/test-utils/index';

function captureAuthorization(): { header: string | null | undefined } {
  const seen: { header: string | null | undefined } = { header: undefined };
  server.use(
    http.get(`${API_URL}/products/:id/revisions`, ({ request }) => {
      seen.header = request.headers.get('Authorization');
      return HttpResponse.json({ items: [], total: 0, page: 1, size: 20, pages: 0 });
    }),
  );
  return seen;
}

describe('getRevisions', () => {
  afterEach(() => {
    authRuntime.token = undefined;
  });

  // Native has no session cookie: without the token the owner gets the redacted view.
  it('sends the access token when signed in', async () => {
    authRuntime.token = 'tok-123';
    const seen = captureAuthorization();

    await getRevisions(42, 'product', true);

    expect(seen.header).toBe('Bearer tok-123');
  });

  it('sends no token when signed out', async () => {
    authRuntime.token = 'tok-123';
    const seen = captureAuthorization();

    await getRevisions(42, 'product', false);

    expect(seen.header).toBeNull();
  });
});
