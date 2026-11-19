import { API_URL } from '@/config';
import type { ApiCategoryTreeNode } from '@/types/api';
import type { CPVCategory } from '@/types/CPVCategory';
import { apiFetch } from './client';
import { throwFromResponse } from './errors';

const CPV_TAXONOMY = 'Common Procurement Vocabulary (CPV)';
const TRAILING_ZEROS = /0+$/;
const PAGE_SIZE = 100; // API maximum; a CPV level has far fewer entries.

/**
 * The CPV seed stores a product type as `CPV: <code>` with the trailing zero padding dropped
 * (backend `seed_product_types`), while the category keeps the padded code in `external_id`.
 */
function cpvProductTypeName(externalId: string): string {
  return `CPV: ${externalId.replace(TRAILING_ZEROS, '')}`;
}

/**
 * The CPV categories directly under `parentId`, or the top-level ones when it is omitted.
 * Depth 2 returns each entry's own children, which gives the subcategory count.
 */
export async function fetchCpvChildren(parentId?: number): Promise<CPVCategory[]> {
  const url = new URL(
    parentId === undefined
      ? `${API_URL}/categories/tree`
      : `${API_URL}/categories/${parentId}/subcategories/tree`,
  );
  if (parentId === undefined) url.searchParams.set('taxonomy_name[ilike]', CPV_TAXONOMY);
  url.searchParams.set('recursion_depth', '2');
  url.searchParams.set('size', String(PAGE_SIZE));
  const response = await apiFetch(url, { method: 'GET' });
  if (!response.ok) await throwFromResponse(response, "Couldn't load the category list.");
  const data = (await response.json()) as { items?: ApiCategoryTreeNode[] };
  return (data.items ?? []).flatMap((node) =>
    node.external_id
      ? [
          {
            id: node.id,
            name: cpvProductTypeName(node.external_id),
            description: node.name,
            childCount: node.subcategories?.length ?? 0,
          },
        ]
      : [],
  );
}
