import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useDebounce } from 'use-debounce';
import { topCategoriesQueryOptions } from '@/features/products/queries';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { fetchCpvChildren } from '@/services/api/categories';
import {
  fetchProductTypesByName,
  type ProductTypeOption,
  searchProductTypes,
} from '@/services/api/productTypes';
import type { CPVCategory } from '@/types/CPVCategory';
import { setPendingTypeSelection } from './pendingTypeSelection';
import { useRecentCategories } from './useRecentCategories';

const asItem = (type: ProductTypeOption): CPVCategory => ({
  id: type.id,
  name: type.name,
  description: type.description ?? '',
  childCount: 0,
});

export function useCategorySelection() {
  const router = useRouter();
  // Safe redirect if the session expired while the picker was open.
  const { user } = useRequireAuth('/products');

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery] = useDebounce(searchQuery, 300);
  // The branches entered so far; empty at the top level.
  const [history, setHistory] = useState<CPVCategory[]>([]);
  const [selectFailed, setSelectFailed] = useState(false);
  const { recents, recordRecent } = useRecentCategories();
  // Public aggregate; a failure just hides the shortcut section.
  const { data: topCategories } = useQuery(topCategoriesQueryOptions);

  const parentId = history.at(-1)?.id;
  const browse = useQuery({
    queryKey: ['cpv-children', parentId ?? 'root'] as const,
    queryFn: () => fetchCpvChildren(parentId),
    staleTime: Infinity,
    retry: false,
  });
  // Search runs on the server across every level, whatever branch is open.
  const search = useQuery({
    queryKey: ['product-types', 'search', debouncedSearchQuery] as const,
    queryFn: async () => (await searchProductTypes(debouncedSearchQuery)).map(asItem),
    enabled: debouncedSearchQuery !== '',
    staleTime: 60_000,
    retry: false,
  });
  const active = debouncedSearchQuery ? search : browse;

  // Stats report a type by stored name (the CPV code); resolve it to the product type row.
  const commonNames = useMemo(() => topCategories?.map(({ name }) => name) ?? [], [topCategories]);
  const { data: commonTypes = [] } = useQuery({
    queryKey: ['product-types', 'by-name', commonNames] as const,
    queryFn: async () => {
      const rows = await fetchProductTypesByName(commonNames);
      return commonNames.flatMap((name) => rows.filter((row) => row.name === name).map(asItem));
    },
    enabled: commonNames.length > 0,
    staleTime: Infinity,
    retry: false,
  });

  const selectBranch = (item: CPVCategory) => setHistory((h) => [...h, item]);
  const moveUp = () => setHistory((h) => h.slice(0, -1));

  const selectType = useCallback(
    async (item: CPVCategory) => {
      setSelectFailed(false);
      try {
        // Browse rows carry a category id, not the database product type id: resolve by stored name.
        const row = (await fetchProductTypesByName([item.name])).find(
          (option) => option.name === item.name,
        );
        if (!row) throw new Error(`No product type named ${item.name}`);
        recordRecent(item);
        // Hand the pick back through the module slot; the detail screen reads it on focus.
        setPendingTypeSelection(row.id);
        router.back();
      } catch {
        setSelectFailed(true);
      }
    },
    [recordRecent, router],
  );

  return {
    user,
    history,
    filtered: active.data ?? [],
    loading: active.isPending,
    loadFailed: active.isError,
    retryLoad: active.refetch,
    selectFailed,
    commonTypes,
    recents,
    searchQuery,
    debouncedSearchQuery,
    setSearchQuery,
    selectBranch,
    moveUp,
    selectType,
  };
}
