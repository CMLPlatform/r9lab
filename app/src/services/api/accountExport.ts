import { API_URL } from '@/config';
import { fetchWithAuth } from '@/services/api/auth/authRefresh';
import { throwFromResponse } from './errors';

export const ACCOUNT_EXPORT_URL = `${API_URL}/users/me/export`;

/**
 * Start the download of the account archive (web only). The browser fetches the
 * archive itself, so a ZIP of several gigabytes streams to disk rather than into
 * memory, with the session cookie sent along. A plain link cannot renew an expired
 * access cookie, so a /users/me request goes first and renews it if needed.
 */
export async function startAccountExport(): Promise<void> {
  const session = await fetchWithAuth(`${API_URL}/users/me`, {
    headers: { Accept: 'application/json' },
  });
  if (!session.ok) await throwFromResponse(session, 'Sign in again to download your data.');
  const link = document.createElement('a');
  link.href = ACCOUNT_EXPORT_URL;
  link.download = '';
  link.click();
}
