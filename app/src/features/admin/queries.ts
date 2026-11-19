import {
  keepPreviousData,
  type QueryClient,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useAuth } from '@/context/auth';
import {
  type AdminUser,
  type AdminUserRole,
  type AdminUsersQuery,
  type ErasureContent,
  eraseAdminUser,
  fetchAdminUser,
  fetchAdminUsers,
  resetAdminUserMfa,
  setAdminUserActive,
  setAdminUserRole,
} from '@/services/api/adminUsers';

const ADMIN_USERS_KEY = ['admin', 'users'] as const;

/**
 * What the signed-in account may see of the admin section. Presentation only: the
 * backend refuses every `/admin` call unless the caller is an active superuser with
 * TOTP enrolled, so `mfa-required` shows the way there instead of failing calls.
 */
export type AdminAccess = 'none' | 'mfa-required' | 'granted';

export function useAdminAccess(): AdminAccess {
  const { user } = useAuth();
  if (!user?.isSuperuser) return 'none';
  return user.mfaEnabled ? 'granted' : 'mfa-required';
}

export const adminUsersQueryOptions = (query: AdminUsersQuery) =>
  queryOptions({
    queryKey: [...ADMIN_USERS_KEY, 'list', query] as const,
    queryFn: () => fetchAdminUsers(query),
    // Keeps the current page on screen while the next one loads.
    placeholderData: keepPreviousData,
  });

export const adminUserQueryOptions = (id: string) =>
  queryOptions({
    queryKey: [...ADMIN_USERS_KEY, 'detail', id] as const,
    queryFn: () => fetchAdminUser(id),
    enabled: !!id,
  });

export function useAdminUsersQuery(query: AdminUsersQuery) {
  return useQuery(adminUsersQueryOptions(query));
}

export function useAdminUserQuery(id: string) {
  return useQuery(adminUserQueryOptions(id));
}

function invalidateAdminUsers(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: ADMIN_USERS_KEY });
}

/** Every write on one user; each refreshes the list and the detail it changed. */
export function useAdminUserMutations(id: string) {
  const queryClient = useQueryClient();
  const onUpdated = (user: AdminUser) => {
    queryClient.setQueryData(adminUserQueryOptions(id).queryKey, user);
    return invalidateAdminUsers(queryClient);
  };
  const onChanged = () => invalidateAdminUsers(queryClient);
  return {
    setRole: useMutation({
      mutationFn: (role: AdminUserRole) => setAdminUserRole(id, role),
      onSuccess: onUpdated,
    }),
    setActive: useMutation({
      mutationFn: (isActive: boolean) => setAdminUserActive(id, isActive),
      onSuccess: onUpdated,
    }),
    resetMfa: useMutation({ mutationFn: () => resetAdminUserMfa(id), onSuccess: onChanged }),
    erase: useMutation({
      mutationFn: (content: ErasureContent) => eraseAdminUser(id, content),
      onSuccess: () => {
        queryClient.removeQueries({ queryKey: adminUserQueryOptions(id).queryKey });
        return invalidateAdminUsers(queryClient);
      },
    }),
  };
}
