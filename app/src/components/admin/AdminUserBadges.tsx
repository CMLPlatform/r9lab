import { View } from 'react-native';
import { Badge } from '@/components/base/ui/badge';
import { Text } from '@/components/base/ui/text';
import type { AdminUser } from '@/services/api/adminUsers';

/**
 * Account state at a glance; the same badge voice as the account hero. With `exceptionsOnly`
 * (the list) it shows what stands out from a normal account: contributor and two-step stay off.
 */
export function AdminUserBadges({
  user,
  exceptionsOnly = false,
}: {
  user: AdminUser;
  exceptionsOnly?: boolean;
}) {
  const isLab = user.role === 'lab';
  return (
    <View className="flex-row flex-wrap gap-2">
      {user.is_active === false ? (
        <Badge variant="outline">
          <Text className="font-medium text-destructive">Suspended</Text>
        </Badge>
      ) : null}
      {user.is_superuser ? (
        <Badge variant="outline">
          <Text className="font-medium text-manila">Superuser</Text>
        </Badge>
      ) : null}
      {exceptionsOnly && !isLab ? null : (
        <Badge variant="outline">
          <Text className="text-muted-foreground">{isLab ? 'Lab' : 'Contributor'}</Text>
        </Badge>
      )}
      {user.is_verified ? null : (
        <Badge variant="outline">
          <Text className="text-muted-foreground">Unverified</Text>
        </Badge>
      )}
      {user.mfa_enabled && !exceptionsOnly ? (
        <Badge variant="outline">
          <Text className="text-muted-foreground">Two-step on</Text>
        </Badge>
      ) : null}
    </View>
  );
}
