import { useQuery } from '@tanstack/react-query';
import { fetchProductType } from '@/services/api/productTypes';
import type { CPVCategory } from '@/types/CPVCategory';
import type { Product } from '@/types/Product';

export type CpvTypeState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; type: Pick<CPVCategory, 'name' | 'description'> }
  | { status: 'error'; retry?: () => void };

/**
 * Resolves a product type database id to its name and description. A `recorded` type whose
 * id matches is shown as the API returned it; otherwise the type is fetched by id. The
 * bundled CPV snapshot is not consulted: its ids match the database's only by seeding order.
 * A failed fetch is an `error` state with `retry`.
 */
export function useCpvType(
  typeID: number | undefined,
  recorded?: Product['productType'],
): CpvTypeState {
  const recordedMatches = typeID !== undefined && recorded?.id === typeID;
  const { data, isError, isFetching, refetch } = useQuery({
    queryKey: ['product-type', typeID] as const,
    queryFn: () => fetchProductType(typeID as number),
    staleTime: Infinity,
    retry: false,
    enabled: typeID !== undefined && !recordedMatches,
  });

  if (typeID === undefined) return { status: 'idle' };
  if (recordedMatches && recorded) {
    return {
      status: 'ready',
      type: { name: recorded.name, description: recorded.description ?? '' },
    };
  }
  if (data)
    return { status: 'ready', type: { name: data.name, description: data.description ?? '' } };
  if (isError && !isFetching) return { status: 'error', retry: refetch };
  return { status: 'loading' };
}
