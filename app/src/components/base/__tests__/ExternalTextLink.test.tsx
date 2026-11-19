import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { screen } from '@testing-library/react-native';
import { ExternalTextLink } from '@/components/base/ExternalTextLink';
import { openExternalUrl } from '@/services/externalLinks';
import { mockPlatform, renderWithProviders, restorePlatform, setupUser } from '@/test-utils/index';

jest.mock('@/services/externalLinks', () => ({
  openExternalUrl: jest.fn(),
}));

const NEW_TAB_HINT = /opens in new tab/;
const mockOpen = openExternalUrl as jest.MockedFunction<typeof openExternalUrl>;

afterEach(() => {
  restorePlatform();
  mockOpen.mockReset();
});

describe('ExternalTextLink', () => {
  const user = setupUser();

  it('opens the URL on press', async () => {
    await renderWithProviders(
      <ExternalTextLink url="https://example.org/a">Read</ExternalTextLink>,
    );
    await user.press(screen.getByRole('link', { name: 'Read' }));
    expect(mockOpen).toHaveBeenCalledWith('https://example.org/a');
  });

  it('is a real anchor on web, so Enter activates it', async () => {
    mockPlatform('web');
    await renderWithProviders(
      <ExternalTextLink url="https://example.org/a">Read</ExternalTextLink>,
    );
    const link = screen.getByRole('link', { name: 'Read (opens in new tab)' });
    expect(link.props.href).toBe('https://example.org/a');
    expect(link.props.hrefAttrs).toEqual({ target: '_blank', rel: 'noopener noreferrer' });
  });

  it('leaves navigation to the anchor on web, so this tab stays put', async () => {
    mockPlatform('web');
    await renderWithProviders(
      <ExternalTextLink url="https://example.org/a">Read</ExternalTextLink>,
    );
    await user.press(screen.getByRole('link', { name: 'Read (opens in new tab)' }));
    expect(mockOpen).not.toHaveBeenCalled();
  });

  it('says on web that a labelled link opens a new tab', async () => {
    mockPlatform('web');
    await renderWithProviders(
      <ExternalTextLink url="https://example.org/a" accessibilityLabel="Learn more about cameras">
        Learn more
      </ExternalTextLink>,
    );
    expect(
      screen.getByRole('link', { name: 'Learn more about cameras (opens in new tab)' }),
    ).toBeOnTheScreen();
  });

  it('adds no new-tab hint on native, where no tab opens', async () => {
    await renderWithProviders(
      <ExternalTextLink url="https://example.org/a">Read</ExternalTextLink>,
    );
    expect(screen.queryByText(NEW_TAB_HINT)).toBeNull();
  });

  it('renders plain text without a usable URL', async () => {
    await renderWithProviders(<ExternalTextLink url={undefined}>Read</ExternalTextLink>);
    expect(screen.getByText('Read')).toBeOnTheScreen();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('refuses a non-http URL', async () => {
    await renderWithProviders(<ExternalTextLink url="javascript:alert(1)">Read</ExternalTextLink>);
    expect(screen.queryByRole('link')).toBeNull();
  });
});
