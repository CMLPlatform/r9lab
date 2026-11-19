import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, screen, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import { HttpResponse, http } from 'msw';
import { ScrollView } from 'react-native';
import AdminUsersScreen from '@/app/(tabs)/(account)/admin/users/index';
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

const ADMIN_PATH = /\/admin\/users/;

/** Every admin request the screen sends, so a test can assert on what went out or that nothing did. */
function recordAdminRequests() {
  const urls: URL[] = [];
  server.events.on('request:start', ({ request }) => {
    if (ADMIN_PATH.test(request.url)) urls.push(new URL(request.url));
  });
  return urls;
}

describe('Admin users screen', () => {
  const user = setupUser();
  const navigate = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue({ push: jest.fn(), replace: jest.fn(), navigate });
  });

  it('shows nothing of the admin section to a non-superuser and calls no admin route', async () => {
    mockUseAuth.mockReturnValue({ user: mockUser({ isSuperuser: false }), isLoading: false });
    const requests = recordAdminRequests();

    await renderWithProviders(<AdminUsersScreen />, { withDialog: true });

    expect(screen.getByText('For administrators only')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Search users')).toBeNull();
    expect(requests).toEqual([]);
  });

  it('asks a superuser without two-step verification to enrol first instead of failing calls', async () => {
    mockUseAuth.mockReturnValue({
      user: mockUser({ isSuperuser: true, mfaEnabled: false }),
      isLoading: false,
    });
    const requests = recordAdminRequests();

    await renderWithProviders(<AdminUsersScreen />, { withDialog: true });

    expect(screen.getByText('Turn on two-step verification first')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Set up two-step verification' }));
    expect(navigate).toHaveBeenCalledWith('/account');
    expect(requests).toEqual([]);
  });

  it('lists users for an enrolled superuser and sends search and filter as query params', async () => {
    mockUseAuth.mockReturnValue({
      user: mockUser({ isSuperuser: true, mfaEnabled: true }),
      isLoading: false,
    });
    const requests = recordAdminRequests();

    await renderWithProviders(<AdminUsersScreen />, { withDialog: true });

    await waitFor(() => expect(screen.getByText('ada@example.org')).toBeOnTheScreen());
    expect(requests.at(-1)?.searchParams.get('page')).toBe('1');

    await user.type(screen.getByLabelText('Search users'), 'grace');
    await act(() => jest.advanceTimersByTimeAsync(400));
    await waitFor(() => expect(requests.at(-1)?.searchParams.get('search')).toBe('grace'));

    await user.press(screen.getByRole('button', { name: 'Suspended' }));
    await waitFor(() => expect(requests.at(-1)?.searchParams.get('is_active')).toBe('false'));
    expect(requests.at(-1)?.searchParams.get('search')).toBe('grace');
  });

  it('names a user without a username by email, once', async () => {
    mockUseAuth.mockReturnValue({
      user: mockUser({ isSuperuser: true, mfaEnabled: true }),
      isLoading: false,
    });
    server.use(
      http.get(`${API_URL}/admin/users`, () =>
        HttpResponse.json({
          items: [mockAdminUser({ username: null, email: 'anon@example.org' })],
          total: 1,
          page: 1,
          size: 25,
          pages: 1,
        }),
      ),
    );

    await renderWithProviders(<AdminUsersScreen />, { withDialog: true });

    await waitFor(() => expect(screen.getByText('anon@example.org')).toBeOnTheScreen());
    expect(screen.queryByText('No username')).toBeNull();
    expect(screen.getAllByText('anon@example.org')).toHaveLength(1);
  });

  it('pages through the results', async () => {
    mockUseAuth.mockReturnValue({
      user: mockUser({ isSuperuser: true, mfaEnabled: true }),
      isLoading: false,
    });
    server.use(
      http.get(`${API_URL}/admin/users`, ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get('page'));
        return HttpResponse.json({
          items: [mockAdminUser({ email: `page${page}@example.org` })],
          total: 30,
          page,
          size: 25,
          pages: 2,
        });
      }),
    );

    await renderWithProviders(<AdminUsersScreen />, { withDialog: true });

    await waitFor(() => expect(screen.getByText('page1@example.org')).toBeOnTheScreen());
    await user.press(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByText('page2@example.org')).toBeOnTheScreen());
    expect(screen.getByText('Page 2 of 2')).toBeOnTheScreen();
  });

  it('dims the previous rows and scrolls to the top while the next page loads', async () => {
    mockUseAuth.mockReturnValue({
      user: mockUser({ isSuperuser: true, mfaEnabled: true }),
      isLoading: false,
    });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(`${API_URL}/admin/users`, async ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get('page'));
        if (page === 2) await gate;
        return HttpResponse.json({
          items: [mockAdminUser({ email: `page${page}@example.org` })],
          total: 30,
          page,
          size: 25,
          pages: 2,
        });
      }),
    );
    const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo' as never) as unknown as jest.Mock;

    await renderWithProviders(<AdminUsersScreen />, { withDialog: true });
    await waitFor(() => expect(screen.getByText('page1@example.org')).toBeOnTheScreen());
    expect(screen.getByTestId('user-rows')).toHaveProp('aria-busy', false);
    await user.press(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => expect(screen.getByTestId('user-rows')).toHaveProp('aria-busy', true));
    expect(screen.getByText('page1@example.org')).toBeOnTheScreen();
    expect(scrollTo).toHaveBeenCalledWith({ y: 0 });
    release();
    await waitFor(() => expect(screen.getByText('page2@example.org')).toBeOnTheScreen());
    expect(screen.getByTestId('user-rows')).toHaveProp('aria-busy', false);
  });

  it('steps back to the last page when the page it shows no longer exists', async () => {
    mockUseAuth.mockReturnValue({
      user: mockUser({ isSuperuser: true, mfaEnabled: true }),
      isLoading: false,
    });
    // The only user on page 3 is removed after page 2 loaded, so page 3 comes back empty.
    let removed = false;
    server.use(
      http.get(`${API_URL}/admin/users`, ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get('page'));
        if (page === 3) removed = true;
        return HttpResponse.json({
          items: page === 3 ? [] : [mockAdminUser({ email: `page${page}@example.org` })],
          total: removed ? 50 : 51,
          page,
          size: 25,
          pages: removed ? 2 : 3,
        });
      }),
    );

    await renderWithProviders(<AdminUsersScreen />, { withDialog: true });

    await waitFor(() => expect(screen.getByText('page1@example.org')).toBeOnTheScreen());
    await user.press(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByText('page2@example.org')).toBeOnTheScreen());
    await user.press(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => expect(screen.getByText('page2@example.org')).toBeOnTheScreen());
    expect(screen.getByText('Page 2 of 2')).toBeOnTheScreen();
  });
});
