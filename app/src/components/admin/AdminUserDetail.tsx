import { useRouter } from 'expo-router';
import Head from 'expo-router/head';
import { useCallback } from 'react';
import { ScrollView, View } from 'react-native';
import { AppText } from '@/components/base/AppText';
import { CenteredSpinner } from '@/components/base/CenteredSpinner';
import { ErrorState } from '@/components/base/ErrorState';
import { PageContainer } from '@/components/base/PageContainer';
import { PageHeaderRow } from '@/components/base/PageHeaderRow';
import { ProfileAction } from '@/components/profile/shared';
import { createProfileSectionStyles } from '@/components/profile/styles';
import { useAuth } from '@/context/auth';
import { useAdminUserQuery } from '@/features/admin/queries';
import { useAdminUserActions } from '@/features/admin/useAdminUserActions';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import type { AdminUser } from '@/services/api/adminUsers';
import { useAppTheme } from '@/theme/appThemeContext';
import { heading } from '@/utils/a11y';
import { getErrorMessage } from '@/utils/errors';
import { AdminUserBadges } from './AdminUserBadges';

function SectionTitle({ title }: { title: string }) {
  return (
    <AppText variant="heading" {...heading(2)} className="mt-6 mb-1 px-4">
      {title}
    </AppText>
  );
}

// The admin routes skip the password and code step-up of the self-service ones, so an
// admin changes their own two-step verification or deletes their own account there.
function OwnAccountNotice() {
  const router = useRouter();
  const goToAccount = useCallback(() => router.navigate('/account'), [router]);
  return (
    <>
      <SectionTitle title="Your account" />
      <ProfileAction
        title="Open your account settings"
        subtitle="Change your two-step verification or delete your account there"
        onPress={goToAccount}
      />
    </>
  );
}

function UserActions({ user }: { user: AdminUser }) {
  const styles = createProfileSectionStyles(useAppTheme());
  const actions = useAdminUserActions(user);
  const { nextRole } = actions;

  return (
    <>
      <SectionTitle title="Access" />
      {user.is_superuser ? null : (
        <ProfileAction
          title={nextRole === 'lab' ? 'Make lab account' : 'Make contributor account'}
          subtitle={`Now: ${user.role === 'lab' ? 'lab' : 'contributor'}`}
          onPress={actions.changeRole}
        />
      )}
      {user.mfa_enabled ? (
        <ProfileAction
          title="Reset two-step verification"
          subtitle="For someone who lost their authenticator and recovery codes"
          onPress={actions.resetTwoStep}
          titleStyle={styles.danger}
        />
      ) : null}
      {user.is_active === false ? (
        <ProfileAction
          title="Reactivate account"
          subtitle="Let them sign in again"
          onPress={actions.reactivate}
        />
      ) : (
        <ProfileAction
          title="Suspend account"
          subtitle="Sign them out and block sign-in, keep their data"
          onPress={actions.suspend}
          titleStyle={styles.danger}
        />
      )}

      <SectionTitle title="Danger zone" />
      <ProfileAction
        title="Delete account"
        subtitle="Erase the account and its personal data"
        onPress={actions.eraseAccount}
        titleStyle={styles.danger}
      />
    </>
  );
}

export function AdminUserDetail({ id }: { id: string }) {
  const router = useRouter();
  const { isLg } = useBreakpoint();
  const { user: me } = useAuth();
  const query = useAdminUserQuery(id);
  const { refetch } = query;
  const handleRetry = useCallback(() => refetch(), [refetch]);
  const goToUsers = useCallback(() => router.replace('/admin/users'), [router]);

  if (query.isLoading) return <CenteredSpinner />;
  if (!query.data) {
    return (
      <ErrorState
        message={getErrorMessage(query.error, "Couldn't load the user.")}
        onRetry={handleRetry}
      />
    );
  }
  const user = query.data;
  const name = user.username ?? user.email;
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
      <Head>
        <title>{`${user.username ?? user.email} · Users · R9lab`}</title>
      </Head>
      <PageContainer>
        {/* The stack header is hidden behind TopNav at >=lg. */}
        {isLg ? <PageHeaderRow title={name} onBack={goToUsers} /> : null}
        <View className="gap-2 px-4 pt-4">
          {isLg ? null : (
            <AppText variant="title" {...heading(1)}>
              {name}
            </AppText>
          )}
          {user.username ? (
            <AppText variant="data" selectable>
              {user.email}
            </AppText>
          ) : null}
          <AdminUserBadges user={user} />
        </View>
        {me?.id === user.id ? <OwnAccountNotice /> : <UserActions user={user} />}
      </PageContainer>
    </ScrollView>
  );
}
