import { beforeEach, describe, expect, it } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { HttpResponse, http } from 'msw';
import type React from 'react';
import { API_URL } from '@/config';
import { useCpvType } from '@/features/products/useCpvType';
import { server } from '@/test-utils/server';

const cat = { id: 5, name: 'Plastics', description: 'd' };

let client: QueryClient;
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useCpvType', () => {
  beforeEach(() => {
    client = new QueryClient();
  });

  it('returns idle without fetching when there is no type id', async () => {
    let requested = false;
    server.use(
      http.get(`${API_URL}/product-types/:id`, () => {
        requested = true;
        return HttpResponse.json(cat);
      }),
    );
    const { result } = await renderHook(() => useCpvType(undefined), { wrapper });
    expect(result.current.status).toBe('idle');
    expect(requested).toBe(false);
  });

  it('skips the request when the recorded type matches the id', async () => {
    let requested = false;
    server.use(
      http.get(`${API_URL}/product-types/:id`, () => {
        requested = true;
        return HttpResponse.json(cat);
      }),
    );
    const { result } = await renderHook(() => useCpvType(5, cat), { wrapper });
    expect(result.current).toEqual({
      status: 'ready',
      type: { name: 'Plastics', description: 'd' },
    });
    expect(requested).toBe(false);
  });

  it('reads the type from the API by database id', async () => {
    server.use(http.get(`${API_URL}/product-types/5`, () => HttpResponse.json(cat)));
    const { result } = await renderHook(() => useCpvType(5), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current).toMatchObject({ type: { name: 'Plastics', description: 'd' } });
  });

  it('reports an error with a working retry instead of staying silent', async () => {
    server.use(http.get(`${API_URL}/product-types/5`, () => HttpResponse.error()));
    const { result } = await renderHook(() => useCpvType(5), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('error'));

    server.use(http.get(`${API_URL}/product-types/5`, () => HttpResponse.json(cat)));
    await act(async () => {
      if (result.current.status === 'error') result.current.retry?.();
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });
});
