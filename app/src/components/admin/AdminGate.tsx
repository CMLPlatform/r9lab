import { useRouter } from 'expo-router';
import { type ReactNode, useCallback } from 'react';
import { CenteredSpinner } from '@/components/base/CenteredSpinner';
import { ErrorState } from '@/components/base/ErrorState';
import { useAuth } from '@/context/auth';
import { useAdminAccess } from '@/features/admin/queries';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { useAppTheme } from '@/theme/appThemeContext';

/**
 * Renders the admin screens only for a superuser who can use them. Hiding is UX:
 * the backend refuses every `/admin` call to anyone else.
 */
export function AdminGate({ redirectTo, children }: { redirectTo: string; children: ReactNode }) {
  const router = useRouter();
  const theme = useAppTheme();
  const { user } = useAuth();
  const access = useAdminAccess();
  useRequireAuth(redirectTo);
  const goToAccount = useCallback(() => router.navigate('/account'), [router]);

  // Only hit for the one-render window before useRequireAuth's redirect completes.
  if (!user) return <CenteredSpinner />;
  if (access === 'none') {
    return (
      <ErrorState
        icon="lock"
        iconColor={theme.colors.mutedForeground}
        title="For administrators only"
        message="This page is for R9lab administrators."
        actionLabel="Back to account"
        onRetry={goToAccount}
      />
    );
  }
  if (access === 'mfa-required') {
    return (
      <ErrorState
        icon="lock"
        iconColor={theme.colors.primary}
        title="Turn on two-step verification first"
        message="Admin tools need two-step verification on your own account. Turn it on under Security & sessions, then come back."
        actionLabel="Set up two-step verification"
        onRetry={goToAccount}
      />
    );
  }
  return children;
}
