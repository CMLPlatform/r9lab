import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { HttpResponse, http } from 'msw';
import AdminUserScreen from '@/app/(tabs)/(account)/admin/users/[id]';
import { API_URL } from '@/config';
import {
  mockAdminUser,
  mockUser,
  renderWithProviders,
  server,
  setupUser,
} from '@/test-utils/index';
import type { User } from '@/types/User';

const mockUseAuth = jest.fn<() => { user: User | undefined; isLoading: boolean }>();
jest.mock('@/context/auth', () => ({ useAuth: () => mockUseAuth() }));

const TARGET_ID = '7d9f3c4e-0a1b-4c2d-8e3f-5a6b7c8d9e0f';
const ADMIN_ID = 'a0a0a0a0-0000-4000-8000-000000000001';

// Settings rows are named "title, subtitle"; these match on the title.
const MAKE_LAB = /^Make lab account/;
const MAKE_CONTRIBUTOR = /^Make contributor account/;
const RESET_MFA = /^Reset two-step verification/;
const SUSPEND = /^Suspend account/;
const REACTIVATE = /^Reactivate account/;
const DELETE_ACCOUNT = /^Delete account/;

type Sent = { method: string; url: URL; body: unknown };

/** The writes the screen sends to the admin routes, with their JSON bodies. */
function recordAdminWrites() {
  const sent: Sent[] = [];
  server.events.on('request:start', async ({ request }) => {
    if (!request.url.includes('/admin/users') || request.method === 'GET') return;
    const text = await request.clone().text();
    sent.push({
      method: request.method,
      url: new URL(request.url),
      body: text ? JSON.parse(text) : null,
    });
  });
  return sent;
}

async function renderDetail(target = mockAdminUser({ id: TARGET_ID })) {
  server.use(http.get(`${API_URL}/admin/users/:id`, () => HttpResponse.json(target)));
  await renderWithProviders(<AdminUserScreen />, { withDialog: true });
  await waitFor(() => expect(screen.getByText(target.email)).toBeOnTheScreen());
}

describe('Admin user detail screen', () => {
  const user = setupUser();
  const navigate = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: TARGET_ID });
    (useRouter as jest.Mock).mockReturnValue({ push: jest.fn(), replace: jest.fn(), navigate });
    mockUseAuth.mockReturnValue({
      user: mockUser({ id: ADMIN_ID, isSuperuser: true, mfaEnabled: true }),
      isLoading: false,
    });
  });

  it('sets the role after confirming', async () => {
    const sent = recordAdminWrites();
    await renderDetail();

    await user.press(screen.getByRole('button', { name: MAKE_LAB }));
    await user.press(screen.getByRole('button', { name: 'Change role' }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ method: 'PUT', body: { role: 'lab' } });
    expect(sent[0]?.url.pathname.endsWith(`/admin/users/${TARGET_ID}/role`)).toBe(true);
  });

  it('resets two-step verification after confirming', async () => {
    const sent = recordAdminWrites();
    await renderDetail();

    await user.press(screen.getByRole('button', { name: RESET_MFA }));
    await user.press(screen.getByRole('button', { name: 'Reset' }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.method).toBe('POST');
    expect(sent[0]?.url.pathname.endsWith(`/admin/users/${TARGET_ID}/mfa/reset`)).toBe(true);
  });

  it('suspends an active account', async () => {
    const sent = recordAdminWrites();
    await renderDetail();

    await user.press(screen.getByRole('button', { name: SUSPEND }));
    await user.press(screen.getByRole('button', { name: 'Suspend' }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ method: 'PUT', body: { is_active: false } });
    expect(sent[0]?.url.pathname.endsWith(`/admin/users/${TARGET_ID}/active`)).toBe(true);
  });

  it('reactivates a suspended account', async () => {
    const sent = recordAdminWrites();
    await renderDetail(mockAdminUser({ id: TARGET_ID, is_active: false }));

    await user.press(screen.getByRole('button', { name: REACTIVATE }));
    await user.press(screen.getByRole('button', { name: 'Reactivate' }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ method: 'PUT', body: { is_active: true } });
  });

  it('offers no suspension of the signed-in admin’s own account', async () => {
    await renderDetail(mockAdminUser({ id: ADMIN_ID, is_superuser: true, role: 'lab' }));

    expect(screen.queryByRole('button', { name: SUSPEND })).toBeNull();
    // A superuser always holds the lab tier, so no role change is offered either.
    expect(screen.queryByRole('button', { name: MAKE_CONTRIBUTOR })).toBeNull();
  });

  it('erases only after the email is typed, with the chosen content policy', async () => {
    const sent = recordAdminWrites();
    await renderDetail();

    await user.press(screen.getByRole('button', { name: DELETE_ACCOUNT }));
    await user.press(screen.getByRole('button', { name: 'Delete products too' }));

    const confirm = screen.getByRole('button', { name: 'Delete' });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByPlaceholderText('ada@example.org'), 'ADA@example.org');
    expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled();
    await user.press(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.method).toBe('DELETE');
    expect(sent[0]?.url.searchParams.get('content')).toBe('delete');
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/admin/users'));
  });

  it('shows the server’s refusal instead of failing silently', async () => {
    server.use(
      http.put(`${API_URL}/admin/users/:id/active`, () =>
        HttpResponse.json(
          { detail: 'The last active superuser cannot be suspended.' },
          { status: 409 },
        ),
      ),
    );
    await renderDetail(mockAdminUser({ id: TARGET_ID, is_superuser: true, role: 'lab' }));

    await user.press(screen.getByRole('button', { name: SUSPEND }));
    await user.press(screen.getByRole('button', { name: 'Suspend' }));

    await waitFor(() =>
      expect(screen.getByText('The last active superuser cannot be suspended.')).toBeOnTheScreen(),
    );
  });
});
