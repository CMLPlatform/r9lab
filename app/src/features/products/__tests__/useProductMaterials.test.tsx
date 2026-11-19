import { describe, expect, it } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { HttpResponse, http } from 'msw';
import type { ReactNode } from 'react';
import { DialogProvider } from '@/components/base/DialogProvider';
import { API_URL } from '@/config';
import { useProductMaterials } from '@/features/products/useProductMaterials';
import { baseProduct, server } from '@/test-utils/index';

describe('useProductMaterials', () => {
  function wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return (
      <QueryClientProvider client={client}>
        <DialogProvider>{children}</DialogProvider>
      </QueryClientProvider>
    );
  }

  it('saves two quick changes to one record in the order they were made', async () => {
    const bodies: unknown[] = [];
    let releaseFirst = () => {};
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    server.use(
      http.get(`${API_URL}/:root/:id/materials`, () => HttpResponse.json([])),
      http.patch(`${API_URL}/products/:id/materials/:materialId`, async ({ request }) => {
        bodies.push(await request.json());
        if (bodies.length === 1) await firstHeld;
        return HttpResponse.json({});
      }),
    );
    const { result } = await renderHook(() => useProductMaterials(baseProduct, true), { wrapper });

    await act(async () => {
      result.current.update.mutate({ materialID: 7, unit: 'kg' });
      result.current.update.mutate({ materialID: 7, unit: 'cm' });
    });
    await waitFor(() => expect(bodies).toEqual([{ unit: 'kg' }]));
    // The second change waits for the first to answer. Timers are fake; setImmediate is not.
    const turn = () => new Promise((resolve) => setImmediate(resolve));
    await turn();
    await turn();
    await turn();
    expect(bodies).toHaveLength(1);

    await act(async () => releaseFirst());
    await waitFor(() => expect(bodies).toEqual([{ unit: 'kg' }, { unit: 'cm' }]));
  });
});
