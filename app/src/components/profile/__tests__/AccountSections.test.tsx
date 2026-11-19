import { describe, expect, it, jest } from '@jest/globals';
import { screen } from '@testing-library/react-native';
import {
  ProfileAccountSection,
  ProfileDangerZoneSection,
  ProfileLinkedAccountsSection,
} from '@/components/profile/AccountSections';
import { renderWithProviders } from '@/test-utils/index';

const noop = jest.fn();

function titleColor(name: string) {
  return screen
    .getByText(name)
    .props.style.flat()
    .find((s: { color?: string }) => s?.color)?.color;
}

describe('Account sections', () => {
  it('spends the destructive colour on deleting the account only', async () => {
    await renderWithProviders(
      <>
        <ProfileAccountSection
          isVerified
          onLogout={noop}
          onRevokeAllSessions={noop}
          onVerifyAccount={noop}
        />
        <ProfileLinkedAccountsSection
          isGoogleLinked
          isGithubLinked={false}
          googleAccount={{ account_email: 'a@example.org' } as never}
          onLinkOAuth={noop}
          onRequestUnlink={noop}
        />
        <ProfileDangerZoneSection onDeleteAccount={noop} />
      </>,
    );
    const danger = titleColor('Delete account');
    expect(danger).toBeDefined();
    for (const name of ['Sign out', 'Sign out everywhere', 'Unlink Google']) {
      expect(titleColor(name)).not.toBe(danger);
    }
  });

  it('leaves out the "Connected as" line when the provider gave no email', async () => {
    await renderWithProviders(
      <ProfileLinkedAccountsSection
        isGoogleLinked
        isGithubLinked={false}
        googleAccount={{ account_email: '' } as never}
        onLinkOAuth={noop}
        onRequestUnlink={noop}
      />,
    );
    expect(screen.queryByText('Connected as', { exact: false })).toBeNull();
  });
});
