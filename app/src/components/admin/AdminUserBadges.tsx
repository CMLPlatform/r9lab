import { View } from 'react-native';
import { Badge } from '@/components/base/ui/badge';
import { Text } from '@/components/base/ui/text';
import type { AdminUser } from '@/services/api/adminUsers';

/** Account state at a glance; the same badge voice as the account hero. */
export function AdminUserBadges({ user }: { user: AdminUser }) {
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
      <Badge variant="outline">
        <Text className="text-muted-foreground">{user.role === 'lab' ? 'Lab' : 'Contributor'}</Text>
      </Badge>
      {user.is_verified ? null : (
        <Badge variant="outline">
          <Text className="text-muted-foreground">Unverified</Text>
        </Badge>
      )}
      {user.mfa_enabled ? (
        <Badge variant="outline">
          <Text className="text-muted-foreground">Two-step on</Text>
        </Badge>
      ) : null}
    </View>
  );
}
