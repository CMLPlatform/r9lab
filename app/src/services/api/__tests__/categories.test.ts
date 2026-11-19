import { describe, expect, it } from '@jest/globals';
import { HttpResponse, http } from 'msw';
import { API_URL } from '@/config';
import { fetchCpvChildren } from '@/services/api/categories';
import { server } from '@/test-utils/server';

describe('fetchCpvChildren', () => {
  it('lists top-level CPV categories under the stored product type name', async () => {
    let url: URL | undefined;
    server.use(
      http.get(`${API_URL}/categories/tree`, ({ request }) => {
        url = new URL(request.url);
        return HttpResponse.json({
          items: [
            {
              id: 5,
              name: 'Computer equipment',
              external_id: '30200000',
              subcategories: [{ id: 6 }, { id: 7 }],
            },
            { id: 8, name: 'No code', external_id: null, subcategories: [] },
          ],
        });
      }),
    );

    // Trailing zero padding is dropped, as the product type seed does; rows without a code are skipped.
    expect(await fetchCpvChildren()).toEqual([
      { id: 5, name: 'CPV: 302', description: 'Computer equipment', childCount: 2 },
    ]);
    expect(url?.searchParams.get('taxonomy_name[ilike]')).toBe(
      'Common Procurement Vocabulary (CPV)',
    );
  });

  it('lists the children of one category', async () => {
    server.use(
      http.get(`${API_URL}/categories/5/subcategories/tree`, () =>
        HttpResponse.json({
          items: [{ id: 6, name: 'Tablet computer', external_id: '30213200', subcategories: [] }],
        }),
      ),
    );

    expect(await fetchCpvChildren(5)).toEqual([
      { id: 6, name: 'CPV: 302132', description: 'Tablet computer', childCount: 0 },
    ]);
  });

  it('throws when the request fails', async () => {
    server.use(
      http.get(`${API_URL}/categories/tree`, () => new HttpResponse(null, { status: 500 })),
    );
    await expect(fetchCpvChildren()).rejects.toThrow();
  });
});
