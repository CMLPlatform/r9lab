import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDebounce } from 'use-debounce';
import {
  cpvChildrenQueryOptions,
  productTypeLabelsQueryOptions,
  productTypesSearchQueryOptions,
  topCategoriesQueryOptions,
} from '@/features/products/queries';
import { fetchProductTypesByName, type ProductTypeOption } from '@/services/api/productTypes';
import type { CPVCategory } from '@/types/CPVCategory';
import { useRecentCategories } from './useRecentCategories';

const asItem = (type: ProductTypeOption): CPVCategory => ({
  id: type.id,
  name: type.name,
  description: type.description ?? '',
  childCount: 0,
});

/**
 * Picks a category as the product type: resolves its row, hands the id on, and records the
 * category as recent unless `onSelect` returns false (the list closed before the lookup ended).
 */
export function usePickProductType(onSelect: (typeId: number) => boolean | undefined) {
  const [pickFailed, setPickFailed] = useState(false);
  const [picking, setPicking] = useState(false);
  const recordRecent = useRecentCategories((state) => state.recordRecent);
  // One lookup at a time: a second tap while the first resolves would race it.
  const pending = useRef(false);
  // A pick that resolves after its list closed (Escape mid-lookup) is dropped.
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const pick = useCallback(
    async (item: CPVCategory) => {
      if (pending.current) return;
      pending.current = true;
      setPicking(true);
      setPickFailed(false);
      try {
        // Browse rows carry a category id, not the database product type id: resolve by stored name.
        const row = (await fetchProductTypesByName([item.name])).find(
          (option) => option.name === item.name,
        );
        if (!row) throw new Error(`No product type named ${item.name}`);
        if (!live.current) return;
        if (onSelect(row.id) !== false) recordRecent(item);
      } catch {
        if (live.current) setPickFailed(true);
      } finally {
        pending.current = false;
        if (live.current) setPicking(false);
      }
    },
    [recordRecent, onSelect],
  );

  const clearPickError = useCallback(() => setPickFailed(false), []);
  return { pick, picking, pickFailed, clearPickError };
}

/** The most used types across R9lab and this device's recent picks: the no-typing shortcuts. */
export function useTypeShortcuts() {
  const recents = useRecentCategories((state) => state.recents);
  // Public aggregate; a failure just hides the shortcut section.
  const { data: topCategories } = useQuery(topCategoriesQueryOptions);
  // Stats report a type by stored name (the CPV code); resolve it to the product type row.
  const commonNames = useMemo(() => topCategories?.map(({ name }) => name) ?? [], [topCategories]);
  const { data: commonTypes = [] } = useQuery({
    ...productTypeLabelsQueryOptions(commonNames),
    select: (rows) =>
      commonNames.flatMap((name) => rows.filter((row) => row.name === name).map(asItem)),
  });
  return { commonTypes, recents };
}

/** True when one query extends the other: the same word being typed or trimmed. */
export function isSameWord(a: string, b: string): boolean {
  return a !== '' && b !== '' && (a.startsWith(b) || b.startsWith(a));
}

/** Server-side search across every level of the tree, debounced. */
export function useProductTypeSearch(searchQuery: string) {
  const [debouncedSearchQuery] = useDebounce(searchQuery, 300);
  // The previous results stay up while the next keystroke loads, so the list does not flash a
  // spinner. Only for the same word being typed or trimmed: after a pick and a fresh word,
  // the old matches would sit under the new query.
  const search = useQuery({
    ...productTypesSearchQueryOptions(debouncedSearchQuery),
    enabled: debouncedSearchQuery !== '',
    placeholderData: (previous, previousQuery) => {
      const before = String(previousQuery?.queryKey[2] ?? '');
      return isSameWord(before, debouncedSearchQuery) ? keepPreviousData(previous) : undefined;
    },
    select: (types) => types.map(asItem),
  });
  return { search, debouncedSearchQuery };
}

/** State for the category browser: search, the branch trail, and the pick. */
export function useCategorySelection(onSelect: (typeId: number) => boolean | undefined) {
  const [searchQuery, setSearchQuery] = useState('');
  const { search, debouncedSearchQuery } = useProductTypeSearch(searchQuery);
  // The branches entered so far; empty at the top level.
  const [history, setHistory] = useState<CPVCategory[]>([]);
  const { pick, pickFailed } = usePickProductType(onSelect);
  const { commonTypes, recents } = useTypeShortcuts();

  const browse = useQuery({
    ...cpvChildrenQueryOptions(history.at(-1)?.id),
    retry: false,
  });
  const active = debouncedSearchQuery ? search : browse;

  const selectBranch = (item: CPVCategory) => setHistory((h) => [...h, item]);
  const moveUp = () => setHistory((h) => h.slice(0, -1));

  return {
    history,
    filtered: active.data ?? [],
    loading: active.isPending,
    loadFailed: active.isError,
    retryLoad: active.refetch,
    pickFailed,
    commonTypes,
    recents,
    searchQuery,
    debouncedSearchQuery,
    setSearchQuery,
    selectBranch,
    moveUp,
    pick,
  };
}
