import { API_URL } from '@/config';
import { fetchWithAuth } from '@/services/api/auth/authRefresh';
import type { ApiMaterialLink, ApiMaterialUnit } from '@/types/api';
import type { Product, ProductMaterial } from '@/types/Product';
import { apiFetch } from './client';
import { throwFromResponse } from './errors';
import { toProductMaterials } from './products';

/**
 * Bill-of-materials rows. Like research files they are written immediately on a
 * saved record, not with the draft: the routes are per row and carry no `If-Match`
 * version, so two tabs editing one row are last-write-wins.
 */

/** A material the picker can offer. */
export type MaterialOption = { id: number; name: string; description?: string };

const PAGE_SIZE = 100; // the API's maximum

function materialsUrl(product: Product, materialID?: number): URL {
  const root = product.role === 'component' ? 'components' : 'products';
  const suffix = materialID === undefined ? '' : `/${materialID}`;
  return new URL(`${API_URL}/${root}/${product.id}/materials${suffix}`);
}

/** The whole material list, for client-side search: it is a few hundred rows at most. */
export async function fetchAllMaterials(): Promise<MaterialOption[]> {
  const all: MaterialOption[] = [];
  for (let page = 1; ; page++) {
    const url = new URL(`${API_URL}/materials`);
    url.searchParams.set('page', String(page));
    url.searchParams.set('size', String(PAGE_SIZE));
    // biome-ignore lint/performance/noAwaitInLoops: each page needs the previous total.
    const response = await apiFetch(url, { method: 'GET' });
    if (!response.ok) await throwFromResponse(response, "Couldn't load the materials. Try again.");
    const data = (await response.json()) as {
      items?: { id: number; name: string; description?: string | null }[];
      pages?: number;
    };
    for (const item of data.items ?? []) {
      all.push({
        id: item.id,
        name: item.name,
        ...(item.description ? { description: item.description } : {}),
      });
    }
    if (page >= (data.pages ?? 1)) break;
  }
  return all.sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchProductMaterials(product: Product): Promise<ProductMaterial[]> {
  const response = await fetchWithAuth(materialsUrl(product), { method: 'GET' });
  if (!response.ok) await throwFromResponse(response, "Couldn't load the materials. Try again.");
  return toProductMaterials((await response.json()) as ApiMaterialLink[]);
}

export async function addProductMaterial(
  product: Product,
  materialID: number,
  quantity: number,
  unit: ApiMaterialUnit,
): Promise<void> {
  const response = await fetchWithAuth(materialsUrl(product, materialID), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quantity, unit }),
  });
  if (!response.ok) await throwFromResponse(response, "Couldn't add the material. Try again.");
}

export async function updateProductMaterial(
  product: Product,
  materialID: number,
  change: { quantity?: number; unit?: ApiMaterialUnit },
): Promise<void> {
  const response = await fetchWithAuth(materialsUrl(product, materialID), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(change),
  });
  if (!response.ok) await throwFromResponse(response, "Couldn't update the material. Try again.");
}

export async function removeProductMaterial(product: Product, materialID: number): Promise<void> {
  const response = await fetchWithAuth(materialsUrl(product, materialID), { method: 'DELETE' });
  // Already gone server-side is the outcome the caller wanted.
  if (response.status === 404) return;
  if (!response.ok) await throwFromResponse(response, "Couldn't remove the material. Try again.");
}
