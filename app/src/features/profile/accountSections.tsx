// Do not export a component from this file (react-refresh/only-export-components).
import type { ReactNode, RefObject } from 'react';
import { View } from 'react-native';
import { ProfileAboutSection } from '@/components/profile/About';
import {
  ProfileAccountSection,
  ProfileDangerZoneSection,
  ProfileLinkedAccountsSection,
} from '@/components/profile/AccountSections';
import { ContributorTermsAction } from '@/components/profile/ContributorTermsAction';
import { DataExportAction } from '@/components/profile/DataExportAction';
import { ProfileIntegrationsSection } from '@/components/profile/Integrations';
import {
  ProfileAppearanceSection,
  ProfileEmailUpdatesSection,
  ProfileVisibilitySection,
} from '@/components/profile/Preferences';
import { ProfileSecuritySection } from '@/components/profile/SecuritySection';
import { ProfileAction } from '@/components/profile/shared';
import type { useProfileScreen } from '@/features/profile/useProfileScreen';
import type { User } from '@/types/User';

export type AccountSectionKey =
  | 'preferences'
  | 'integrations'
  | 'security'
  | 'data'
  | 'admin'
  | 'about'
  | 'danger';

export type AccountSectionContext = ReturnType<typeof useProfileScreen> & {
  onManageCameras: () => void;
  onOpenAdminUsers: () => void;
  onRefetchAuth: () => void;
  /** Return-focus targets for the corresponding dialogs; see AppDialog's `triggerRef`. */
  logoutTriggerRef: RefObject<View | null>;
  deleteAccountTriggerRef: RefObject<View | null>;
  unlinkTriggerRef: RefObject<View | null>;
};

export type AccountSectionDef = {
  key: AccountSectionKey;
  label: string;
  title: string;
  /** Omitted: always shown. */
  visible?: (profile: User) => boolean;
  render: (ctx: AccountSectionContext) => ReactNode;
};

// NOTE: the `return null` guards below only satisfy the `User | undefined`
// type; AccountScreen never calls render() without a profile.
export const ACCOUNT_SECTIONS: AccountSectionDef[] = [
  {
    key: 'preferences',
    label: 'Preferences',
    title: 'Preferences',
    render: ({ profile }) => {
      if (!profile.profile) return null;
      return (
        <>
          <ProfileAppearanceSection
            themeMode={profile.themeMode}
            onSetThemeMode={profile.setThemeMode}
          />
          <ProfileVisibilitySection
            profile={profile.profile}
            visibilitySaving={profile.visibilitySaving}
            onChangeVisibility={profile.handleVisibilityChange}
          />
          <ProfileEmailUpdatesSection
            enabled={profile.emailUpdatesEnabled}
            saving={profile.emailUpdatesSaving}
            onSetEnabled={profile.handleEmailUpdatesChange}
          />
        </>
      );
    },
  },
  {
    key: 'integrations',
    label: 'Integrations',
    title: 'Integrations',
    render: ({ integrations, onManageCameras }) => (
      <ProfileIntegrationsSection
        rpiEnabled={integrations.rpiEnabled}
        rpiLoading={integrations.rpiLoading}
        onSetRpiEnabled={integrations.setRpiEnabled}
        onManageCameras={onManageCameras}
        youtubeEnabled={integrations.youtubeEnabled}
        youtubeLoading={integrations.youtubeLoading}
        youtubeAuthPending={integrations.youtubeAuthPending}
        onToggleYouTube={integrations.handleYouTubeToggle}
      />
    ),
  },
  {
    key: 'security',
    label: 'Security & sessions',
    title: 'Security & sessions',
    render: ({
      profile,
      integrations,
      dialogs,
      actions,
      onRefetchAuth,
      logoutTriggerRef,
      unlinkTriggerRef,
    }) => {
      if (!profile.profile) return null;
      return (
        <>
          <ProfileAccountSection
            isVerified={profile.profile.isVerified}
            onLogout={actions.onLogout}
            onRevokeAllSessions={actions.onRevokeAllSessions}
            onVerifyAccount={actions.onVerifyAccount}
            logoutTriggerRef={logoutTriggerRef}
          />
          <ProfileSecuritySection
            mfaEnabled={profile.profile.mfaEnabled}
            hasUsablePassword={profile.profile.hasUsablePassword}
            onEnrolled={onRefetchAuth}
          />
          <ProfileLinkedAccountsSection
            isGoogleLinked={integrations.isGoogleLinked}
            isGithubLinked={integrations.isGithubLinked}
            googleAccount={integrations.googleAccount}
            githubAccount={integrations.githubAccount}
            onLinkOAuth={integrations.handleLinkOAuth}
            onRequestUnlink={dialogs.unlinkDialog.request}
            unlinkTriggerRef={unlinkTriggerRef}
          />
        </>
      );
    },
  },
  {
    key: 'data',
    label: 'Your data',
    title: 'Your data',
    render: () => <DataExportAction />,
  },
  {
    key: 'admin',
    label: 'Admin',
    title: 'Admin',
    // Presentation only: the backend gates every /admin route on its own.
    visible: (profile) => profile.isSuperuser,
    render: ({ profile, onOpenAdminUsers }) => (
      <View className="mx-1">
        <ProfileAction
          title="Users"
          subtitle={
            profile.profile?.mfaEnabled
              ? 'Roles, two-step verification, suspension and deletion'
              : 'Turn on two-step verification above first'
          }
          icon="circle-user-round"
          onPress={onOpenAdminUsers}
        />
      </View>
    ),
  },
  {
    key: 'about',
    label: 'About',
    title: 'About',
    render: () => (
      <>
        <ProfileAboutSection />
        <ContributorTermsAction />
      </>
    ),
  },
  {
    key: 'danger',
    label: 'Danger zone',
    title: 'Danger zone',
    render: ({ dialogs, deleteAccountTriggerRef }) => (
      <ProfileDangerZoneSection
        onDeleteAccount={dialogs.deleteDialog.open}
        triggerRef={deleteAccountTriggerRef}
      />
    ),
  },
];
