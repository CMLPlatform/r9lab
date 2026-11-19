import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useDebounce } from 'use-debounce';
import {
  cpvChildrenQueryOptions,
  productTypeLabelsQueryOptions,
  productTypesSearchQueryOptions,
  topCategoriesQueryOptions,
} from '@/features/products/queries';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { fetchProductTypesByName, type ProductTypeOption } from '@/services/api/productTypes';
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

  const browse = useQuery({
    ...cpvChildrenQueryOptions(history.at(-1)?.id),
    retry: false,
  });
  // Search runs on the server across every level, whatever branch is open. The previous
  // results stay up while the next keystroke loads, so the list does not flash a spinner.
  const search = useQuery({
    ...productTypesSearchQueryOptions(debouncedSearchQuery),
    enabled: debouncedSearchQuery !== '',
    placeholderData: keepPreviousData,
    select: (types) => types.map(asItem),
  });
  const active = debouncedSearchQuery ? search : browse;

  // Stats report a type by stored name (the CPV code); resolve it to the product type row.
  const commonNames = useMemo(() => topCategories?.map(({ name }) => name) ?? [], [topCategories]);
  const { data: commonTypes = [] } = useQuery({
    ...productTypeLabelsQueryOptions(commonNames),
    select: (rows) =>
      commonNames.flatMap((name) => rows.filter((row) => row.name === name).map(asItem)),
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
