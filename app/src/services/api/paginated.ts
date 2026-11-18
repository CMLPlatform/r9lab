import { apiFetch } from './client';
import { throwFromResponse } from './errors';

/** Fetch one page of items from a paginated search endpoint. */
export async function fetchPaginatedItems<T>(
  path: string,
  search: string | undefined,
  page: number,
  size: number,
): Promise<T[]> {
  const url = new URL(path);
  if (search) url.searchParams.set('search', search);
  url.searchParams.set('page', page.toString());
  url.searchParams.set('size', size.toString());
  const response = await apiFetch(url, { method: 'GET' });
  if (!response.ok) await throwFromResponse(response, "Couldn't load the list. Try again.");
  const data = await response.json();
  return (data.items ?? []) as T[];
}
