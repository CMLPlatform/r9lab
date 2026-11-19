import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { screen, waitFor } from '@testing-library/react-native';
import { HttpResponse, http } from 'msw';
import { DataExportAction } from '@/components/profile/DataExportAction';
import { API_URL } from '@/config';
import { ACCOUNT_EXPORT_URL } from '@/services/api/accountExport';
import {
  mockPlatform,
  renderWithProviders,
  restorePlatform,
  server,
  setupUser,
} from '@/test-utils/index';

const TITLE = 'Download your data';

describe('the download-your-data row', () => {
  const user = setupUser();
  const globals = globalThis as unknown as Record<string, unknown>;
  const originalDocument = globals.document;
  const link = { href: '', target: '', rel: '', click: jest.fn() };

  beforeEach(() => {
    link.href = '';
    link.target = '';
    link.rel = '';
    link.click.mockReset();
    globals.document = { createElement: () => link };
  });

  afterEach(() => {
    restorePlatform();
    globals.document = originalDocument;
  });

  it('on web, renews the session and lets the browser download the archive', async () => {
    let sessionChecks = 0;
    server.use(
      http.get(`${API_URL}/users/me`, () => {
        sessionChecks += 1;
        return HttpResponse.json({ id: 'u1' });
      }),
    );
    mockPlatform('web');
    await renderWithProviders(<DataExportAction />, { withDialog: true });

    await user.press(screen.getByText(TITLE));

    await waitFor(() => expect(link.click).toHaveBeenCalledTimes(1));
    // The browser streams the ZIP to disk itself; the app never holds the bytes.
    expect(link.href).toBe(ACCOUNT_EXPORT_URL);
    expect(ACCOUNT_EXPORT_URL).toBe(`${API_URL}/users/me/export`);
    // A new tab, so a refused download shows its error there and the app stays open.
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener');
    expect(sessionChecks).toBe(1);
    expect(await screen.findByText('Download started')).toBeOnTheScreen();
  });

  it('on web, explains a failed session check instead of starting the download', async () => {
    server.use(
      http.get(`${API_URL}/users/me`, () =>
        HttpResponse.json({ detail: 'Service unavailable' }, { status: 503 }),
      ),
    );
    mockPlatform('web');
    await renderWithProviders(<DataExportAction />, { withDialog: true });

    await user.press(screen.getByText(TITLE));

    expect(await screen.findByText('Download failed')).toBeOnTheScreen();
    expect(link.click).not.toHaveBeenCalled();
  });

  it('on native, points to the web app and offers no button', async () => {
    mockPlatform('ios');
    await renderWithProviders(<DataExportAction />, { withDialog: true });

    expect(screen.getByText(TITLE)).toBeOnTheScreen();
    expect(screen.getByText('Available in the web app')).toBeOnTheScreen();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
