import { Stack, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { HeaderBackButton } from '@/components/base/HeaderBackButton';
import { PlainHeaderTitle } from '@/components/base/PlainHeaderTitle';
import { useBreakpoint } from '@/hooks/useBreakpoint';

/** Account tab stack: the account screen, plus the admin screens a superuser opens from it. */
export default function AccountTabLayout() {
  const router = useRouter();
  const { isLg } = useBreakpoint();
  // Cross-tab target: replace() would reset every tab's trail.
  const goToProducts = useCallback(() => router.navigate('/products'), [router]);
  // Same-stack targets, so replace is safe.
  const goToAccount = useCallback(() => router.replace('/account'), [router]);
  const goToUsers = useCallback(() => router.replace('/admin/users'), [router]);
  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: 'transparent' },
        headerShown: !isLg,
        // The account screen renders the username as its h1.
        headerTitle: PlainHeaderTitle,
      }}
    >
      {/* TopNav covers this screen on >=lg web. */}
      <Stack.Screen
        name="account/index"
        options={{
          title: 'Account',
          headerLeft: (props) => <HeaderBackButton {...props} onPress={goToProducts} />,
        }}
      />
      <Stack.Screen
        name="admin/users/index"
        options={{
          title: 'Users',
          headerLeft: (props) => <HeaderBackButton {...props} onPress={goToAccount} />,
        }}
      />
      <Stack.Screen
        name="admin/users/[id]"
        options={{
          title: 'User',
          headerLeft: (props) => <HeaderBackButton {...props} onPress={goToUsers} />,
        }}
      />
    </Stack>
  );
}
