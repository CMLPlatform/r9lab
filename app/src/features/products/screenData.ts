import { useInfiniteQuery } from '@tanstack/react-query';
import type { useRouter } from 'expo-router';
import { useEffect, useMemo } from 'react';
import type { useAuth } from '@/context/auth';
import { FILTER_CSV_SEPARATOR } from '@/services/api/products';
import { DEFAULT_PRODUCT_SORT, NEWEST_FIRST_SORT, productsInfiniteQueryOptions } from './queries';

export type ProductFilter = 'all' | 'mine';
export type RouterSetParams = Parameters<ReturnType<typeof useRouter>['setParams']>[0];

export type ProductsSearchParams = {
  filterMode?: string;
  q?: string;
  sort?: string;
  brands?: string;
  types?: string;
  days?: string;
  /** '1' when set; any other value counts as off. */
  components?: string;
  complete?: string;
};

function defaultSort(filterMode: ProductFilter, search: string): string[] {
  if (search) return [];
  if (filterMode === 'mine') return [...NEWEST_FIRST_SORT];
  return [...DEFAULT_PRODUCT_SORT];
}

export function normalizeProductsParams(params: ProductsSearchParams) {
  const searchQueryURL = params.q ?? '';
  const activeDatePreset = params.days ? Number(params.days) : null;
  const filterMode = (params.filterMode as ProductFilter) || 'all';

  return {
    filterMode,
    searchQueryURL,
    sortBy: params.sort ? params.sort.split(',') : defaultSort(filterMode, searchQueryURL),
    activeDatePreset,
    // Brand and type values are free user text that may contain commas, so the
    // URL round-trip uses the same separator the API layer sends.
    activeBrands: params.brands ? params.brands.split(FILTER_CSV_SEPARATOR) : [],
    activeProductTypes: params.types ? params.types.split(FILTER_CSV_SEPARATOR) : [],
    hasComponents: params.components === '1',
    complete: params.complete === '1',
  };
}

export function useProductsInfiniteListQuery({
  filterMode,
  searchQueryURL,
  sortBy,
  activeBrands,
  createdAfter,
  activeProductTypes,
  hasComponents,
  complete,
}: {
  filterMode: ProductFilter;
  searchQueryURL: string;
  sortBy: string[];
  activeBrands: string[];
  createdAfter?: Date;
  activeProductTypes: string[];
  hasComponents: boolean;
  complete: boolean;
}) {
  const query = useInfiniteQuery(
    productsInfiniteQueryOptions(filterMode, searchQueryURL, sortBy, {
      brands: activeBrands,
      createdAfter,
      productTypeNames: activeProductTypes,
      hasComponents,
      complete,
    }),
  );

  const products = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );

  return {
    products,
    total: query.data?.pages.at(-1)?.total ?? 0,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: query.fetchNextPage,
    isFetching: query.isFetching,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

export function useProductsParamsSync({
  currentUser,
  debouncedSearchQuery,
  filterMode,
  searchQuery,
  searchQueryURL,
  updateParams,
}: {
  currentUser: ReturnType<typeof useAuth>['user'];
  debouncedSearchQuery: string;
  filterMode: ProductFilter;
  searchQuery: string;
  searchQueryURL: string;
  updateParams: (newParams: RouterSetParams) => void;
}) {
  useEffect(() => {
    // Only push once the debounce has settled, or a lagging value would
    // clobber an external URL reset.
    if (debouncedSearchQuery !== searchQuery) return;
    if (debouncedSearchQuery !== searchQueryURL) {
      updateParams({ q: debouncedSearchQuery || undefined });
    }
  }, [debouncedSearchQuery, searchQuery, searchQueryURL, updateParams]);

  useEffect(() => {
    if (!currentUser && filterMode === 'mine') {
      updateParams({ filterMode: 'all' });
    }
  }, [currentUser, filterMode, updateParams]);
}
