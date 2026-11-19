import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invalidateProductQuery } from '@/features/product-entity/queries';
import { useAppFeedback } from '@/hooks/useAppFeedback';
import { ApiError } from '@/services/api/errors';
import {
  addProductMaterial,
  fetchAllMaterials,
  fetchProductMaterials,
  removeProductMaterial,
  updateProductMaterial,
} from '@/services/api/materials';
import type { ApiMaterialUnit } from '@/types/api';
import type { Product } from '@/types/Product';
import { getErrorMessage } from '@/utils/errors';

const productMaterialsKey = (product: Product) =>
  ['product-materials', product.role, product.id] as const;

/** The whole reference list; it changes rarely, so one fetch serves every picker open. */
export const materialOptionsQueryOptions = {
  queryKey: ['materials', 'all'] as const,
  queryFn: fetchAllMaterials,
  staleTime: 10 * 60_000,
};

/**
 * Bill-of-materials writes for one saved record. Rows save immediately, like
 * research files, so edit mode reads this list, not the draft's copy.
 */
export function useProductMaterials(product: Product, enabled: boolean) {
  const feedback = useAppFeedback();
  const queryClient = useQueryClient();
  const productId = typeof product.id === 'number' ? product.id : undefined;
  const active = enabled && productId !== undefined;

  const listQuery = useQuery({
    queryKey: productMaterialsKey(product),
    queryFn: () => fetchProductMaterials(product),
    enabled: active,
    placeholderData: product.materials,
  });
  const optionsQuery = useQuery({ ...materialOptionsQueryOptions, enabled: active });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: productMaterialsKey(product) });
    if (productId !== undefined) invalidateProductQuery(queryClient, productId);
  };
  const onError = (title: string) => (error: Error) =>
    feedback.error(
      error instanceof ApiError && error.status === 409
        ? 'This material is already in the bill of materials.'
        : getErrorMessage(error, 'Try again.'),
      title,
    );

  const add = useMutation({
    mutationFn: (v: { materialID: number; quantity: number; unit: ApiMaterialUnit }) =>
      addProductMaterial(product, v.materialID, v.quantity, v.unit),
    onSuccess: refresh,
    onError: onError("Couldn't add material"),
  });
  const update = useMutation({
    // One at a time: two quick unit changes sent together could land in either order.
    scope: { id: `product-materials:${productId}` },
    mutationFn: (v: { materialID: number; quantity?: number; unit?: ApiMaterialUnit }) =>
      updateProductMaterial(product, v.materialID, {
        ...(v.quantity === undefined ? {} : { quantity: v.quantity }),
        ...(v.unit === undefined ? {} : { unit: v.unit }),
      }),
    onSuccess: refresh,
    onError: onError("Couldn't update material"),
  });
  const remove = useMutation({
    mutationFn: (materialID: number) => removeProductMaterial(product, materialID),
    onSuccess: refresh,
    onError: onError("Couldn't remove material"),
  });

  return {
    // Outside edit mode the list query is disabled and its cache may be older than the product.
    materials: active ? (listQuery.data ?? product.materials) : product.materials,
    options: optionsQuery.data ?? [],
    optionsLoading: optionsQuery.isLoading,
    add,
    update,
    remove,
  };
}
