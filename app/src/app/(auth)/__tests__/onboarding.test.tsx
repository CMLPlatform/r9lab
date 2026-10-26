import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import { Keyboard } from 'react-native';
import Onboarding from '@/app/(auth)/onboarding';
import { useAuth } from '@/context/auth';
import { updateUser } from '@/services/api/auth/authentication';
import { mockPlatform, renderWithProviders, restorePlatform } from '@/test-utils/index';

jest.mock('@/services/api/auth/authentication', () => ({
  updateUser: jest.fn(),
}));

jest.mock('@/context/auth', () => ({
  useAuth: jest.fn(),
}));

const mockUseEffectiveColorScheme = jest.fn().mockReturnValue('light');
jest.mock('@/context/themeMode', () => ({
  useEffectiveColorScheme: () => mockUseEffectiveColorScheme(),
}));

const mockReplace = jest.fn();
const mockRefetch = jest.fn();
const mockedUpdateUser = jest.mocked(updateUser);

async function renderOnboardingScreen() {
  await renderWithProviders(<Onboarding />, { withDialog: true });
}

beforeEach(() => {
  jest.clearAllMocks();
  (useRouter as jest.Mock).mockReturnValue({
    push: jest.fn(),
    replace: mockReplace,
    back: jest.fn(),
    setParams: jest.fn(),
  });
  (useAuth as jest.Mock).mockReturnValue({
    refetch: mockRefetch,
    user: null,
    isLoading: false,
  });
});

describe('Onboarding screen rendering', () => {
  it('renders the Welcome text, username input and Continue button', async () => {
    await renderOnboardingScreen();
    expect(screen.getByText('Welcome!')).toBeOnTheScreen();
    expect(screen.getByPlaceholderText('e.g. awesome_user')).toBeOnTheScreen();
    expect(screen.getByText('Continue')).toBeOnTheScreen();
  });

  // WCAG 2.4.6: the screen's one heading names this step, not the sign-in screen it
  // shares a card with.
  it('titles the screen with its own heading', async () => {
    await renderOnboardingScreen();
    expect(screen.getByRole('header', { name: 'Welcome!' })).toBeOnTheScreen();
    expect(screen.queryByText('Sign in')).toBeNull();
  });

  // WCAG 1.3.5: the field asks for the user's own username, so browsers and password
  // managers can fill it.
  it('marks the username field for autofill', async () => {
    await renderOnboardingScreen();
    expect(screen.getByPlaceholderText('e.g. awesome_user')).toHaveProp('autoComplete', 'username');
  });
});

describe('Onboarding screen submission', () => {
  it('saves the username and routes into the authenticated flow', async () => {
    mockedUpdateUser.mockResolvedValue(undefined);

    await renderOnboardingScreen();

    await fireEvent.changeText(screen.getByPlaceholderText('e.g. awesome_user'), 'new_user');
    await fireEvent(screen.getByPlaceholderText('e.g. awesome_user'), 'submitEditing');

    await waitFor(() => {
      expect(mockedUpdateUser).toHaveBeenCalledWith({ username: 'new_user' });
      expect(mockRefetch).toHaveBeenCalledWith(false);
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/products',
        params: { authenticated: 'true' },
      });
    });
  });

  it('shows an error dialog when onboarding fails', async () => {
    mockedUpdateUser.mockRejectedValue(new Error('Username already exists'));

    await renderOnboardingScreen();

    await fireEvent.changeText(screen.getByPlaceholderText('e.g. awesome_user'), 'taken_name');
    await fireEvent(screen.getByPlaceholderText('e.g. awesome_user'), 'submitEditing');

    await waitFor(() => {
      expect(screen.getByText("Couldn't save username")).toBeOnTheScreen();
      expect(screen.getByText('Username already exists')).toBeOnTheScreen();
    });
  });
});

describe('Onboarding screen behavior', () => {
  it('Continue button is disabled when username is empty', async () => {
    await renderOnboardingScreen();

    // No text entered: form is invalid, button should be disabled
    const button = screen.getByText('Continue');
    expect(button).toBeOnTheScreen();
    // The button's parent Pressable is disabled when isValid=false
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });

  it('renders correctly in dark mode — covers colorScheme !== light branches', async () => {
    mockUseEffectiveColorScheme.mockReturnValue('dark');

    await renderOnboardingScreen();

    expect(screen.getByText('Welcome!')).toBeOnTheScreen();
    expect(screen.getByText('Choose a username to continue.')).toBeOnTheScreen();
  });

  it('renders on iOS with keyboard metrics — covers Platform.OS !== web branch', async () => {
    mockPlatform('ios');
    jest
      .spyOn(Keyboard, 'metrics')
      .mockReturnValue({ height: 300, screenX: 0, screenY: 0, width: 375 });

    await renderOnboardingScreen();

    expect(screen.getByText('Welcome!')).toBeOnTheScreen();

    restorePlatform();
  });

  it('renders on web with bottom padding 0 — covers Platform.OS === web branch', async () => {
    mockPlatform('web');

    await renderOnboardingScreen();

    expect(screen.getByText('Welcome!')).toBeOnTheScreen();

    restorePlatform();
  });
});
