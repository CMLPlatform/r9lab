import { API_URL } from '@/config';
import { fetchWithAuth } from '@/services/api/auth/authRefresh';
import { throwFromResponse } from './errors';

export const ACCOUNT_EXPORT_URL = `${API_URL}/users/me/export`;

/**
 * Start the download of the account archive (web only). The browser fetches the
 * archive itself, so a ZIP of several gigabytes streams to disk rather than into
 * memory, with the session cookie sent along. A plain link cannot renew an expired
 * access cookie, so a /users/me request goes first and renews it if needed.
 *
 * The link opens a new tab: browsers ignore `download` on a cross-origin link, so a
 * refusal (rate limit, server error) would otherwise replace the app with the error
 * body. An attachment response turns the tab into a download, and the browser
 * closes it again.
 */
export async function startAccountExport(): Promise<void> {
  const session = await fetchWithAuth(`${API_URL}/users/me`, {
    headers: { Accept: 'application/json' },
  });
  if (!session.ok) await throwFromResponse(session, 'Sign in again to download your data.');
  const link = document.createElement('a');
  link.href = ACCOUNT_EXPORT_URL;
  link.target = '_blank';
  link.rel = 'noopener';
  link.click();
}
