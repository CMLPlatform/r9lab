import { useRouter } from 'expo-router';
import Head from 'expo-router/head';
import { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useDebounce } from 'use-debounce';
import { AppButton } from '@/components/base/AppButton';
import { AppText } from '@/components/base/AppText';
import { CenteredSpinner } from '@/components/base/CenteredSpinner';
import { ErrorState } from '@/components/base/ErrorState';
import { MutedText } from '@/components/base/MutedText';
import { PageContainer } from '@/components/base/PageContainer';
import { PageHeaderRow } from '@/components/base/PageHeaderRow';
import { PRESS_TINT } from '@/components/base/pressFeedback';
import { ScreenTitle } from '@/components/base/ScreenTitle';
import { Searchbar } from '@/components/base/Searchbar';
import { useAdminUsersQuery } from '@/features/admin/queries';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import type { AdminUser, AdminUsersFilter } from '@/services/api/adminUsers';
import { cn } from '@/utils/cn';
import { getErrorMessage } from '@/utils/errors';
import { AdminUserBadges } from './AdminUserBadges';

const PAGE_SIZE = 25;

const FILTERS: { key: AdminUsersFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'suspended', label: 'Suspended' },
  { key: 'unverified', label: 'Unverified' },
  { key: 'superusers', label: 'Superusers' },
];

function UserRow({ user, onPress }: { user: AdminUser; onPress: (id: string) => void }) {
  const handlePress = useCallback(() => onPress(user.id), [onPress, user.id]);
  const name = user.username ?? user.email;
  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={user.username ? `${name}, ${user.email}` : name}
      className={cn('min-h-11 gap-1 border-t border-border px-4 py-3', PRESS_TINT)}
    >
      <AppText className="font-semibold">{name}</AppText>
      {user.username ? (
        <AppText variant="caption" className="text-muted-foreground">
          {user.email}
        </AppText>
      ) : null}
      <AdminUserBadges user={user} />
    </Pressable>
  );
}

function FilterButton({
  option,
  selected,
  onSelect,
}: {
  option: (typeof FILTERS)[number];
  selected: boolean;
  onSelect: (key: AdminUsersFilter) => void;
}) {
  const handlePress = useCallback(() => onSelect(option.key), [onSelect, option.key]);
  return (
    <AppButton
      variant={selected ? 'tonal' : 'ghost'}
      // react-native-web drops accessibilityState, so the toggle state also goes out as aria-pressed.
      aria-pressed={selected}
      accessibilityState={{ selected }}
      onPress={handlePress}
    >
      {option.label}
    </AppButton>
  );
}

export function AdminUsersList() {
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);
  const { isLg } = useBreakpoint();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<AdminUsersFilter>('all');
  const [page, setPage] = useState(1);
  const [debouncedSearch] = useDebounce(search.trim(), 300);
  const query = useAdminUsersQuery({ search: debouncedSearch, filter, page, size: PAGE_SIZE });
  const { refetch } = query;
  const pages = Math.max(1, query.data?.pages ?? 1);
  // Removing the last user on the last page leaves that page empty: step back to the new last one.
  if (query.data && page > pages) setPage(pages);

  const handleSearch = useCallback((text: string) => {
    setSearch(text);
    setPage(1);
  }, []);
  const openUser = useCallback(
    (id: string) => router.push({ pathname: '/admin/users/[id]', params: { id } }),
    [router],
  );
  const handleRetry = useCallback(() => refetch(), [refetch]);
  const handleFilter = useCallback((key: AdminUsersFilter) => {
    setFilter(key);
    setPage(1);
  }, []);
  const goToPage = useCallback((step: number) => {
    setPage((p) => p + step);
    scrollRef.current?.scrollTo({ y: 0 });
  }, []);
  const previousPage = useCallback(() => goToPage(-1), [goToPage]);
  const nextPage = useCallback(() => goToPage(1), [goToPage]);
  const goToAccount = useCallback(() => router.replace('/account'), [router]);

  return (
    <ScrollView ref={scrollRef} contentContainerStyle={{ paddingBottom: 40 }}>
      <Head>
        <title>Users · R9lab</title>
      </Head>
      <PageContainer>
        {/* The stack header is hidden behind TopNav at >=lg. */}
        {isLg ? (
          <PageHeaderRow title="Users" onBack={goToAccount} />
        ) : (
          <ScreenTitle>Users</ScreenTitle>
        )}
        <View className="gap-3 py-3">
          <Searchbar
            value={search}
            onChangeText={handleSearch}
            placeholder="Search by email or username"
            accessibilityLabel="Search users"
            loading={query.isFetching && !query.isLoading}
          />
          <View className="flex-row flex-wrap gap-2">
            {FILTERS.map((option) => (
              <FilterButton
                key={option.key}
                option={option}
                selected={filter === option.key}
                onSelect={handleFilter}
              />
            ))}
          </View>
        </View>

        {query.isLoading ? <CenteredSpinner /> : null}
        {query.isError ? (
          <ErrorState
            compact
            message={getErrorMessage(query.error, "Couldn't load the users.")}
            onRetry={handleRetry}
          />
        ) : null}
        {query.data && query.data.items.length === 0 ? (
          <MutedText className="px-4 py-6">No users match.</MutedText>
        ) : null}
        {/* Previous results stay until the new ones arrive: dim them so they do not pass as current. */}
        <View
          testID="user-rows"
          aria-busy={query.isPlaceholderData}
          className={cn(query.isPlaceholderData && 'opacity-50')}
        >
          {query.data?.items.map((user) => (
            <UserRow key={user.id} user={user} onPress={openUser} />
          ))}
        </View>

        {pages > 1 ? (
          <View className="flex-row items-center justify-between border-t border-border pt-3">
            <AppButton variant="outline" disabled={page <= 1} onPress={previousPage}>
              Previous
            </AppButton>
            <AppText variant="caption">
              Page {page} of {pages}
            </AppText>
            <AppButton variant="outline" disabled={page >= pages} onPress={nextPage}>
              Next
            </AppButton>
          </View>
        ) : null}
      </PageContainer>
    </ScrollView>
  );
}
