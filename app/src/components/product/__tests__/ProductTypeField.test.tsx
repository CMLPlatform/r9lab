import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react-native';
import { delay, HttpResponse, http } from 'msw';
import { AccessibilityInfo } from 'react-native';
import { ProductTypeField } from '@/components/product/ProductTypeField';
import { API_URL } from '@/config';
import { usePickProductType } from '@/features/products/useCategorySelection';
import { useRecentCategories } from '@/features/products/useRecentCategories';
import { mockPlatform, renderWithProviders, restorePlatform } from '@/test-utils/index';
import { server } from '@/test-utils/server';

const page = (items: unknown[]) => ({ items, page: 1, pages: 1, size: 50, total: items.length });
const PRODUCT_TYPES = [
  { id: 66, name: 'CPV: 03', description: 'Agricultural products' },
  { id: 77, name: 'CPV: 09', description: 'Petroleum products' },
  { id: 88, name: 'CPV: 031', description: 'Agricultural and horticultural products' },
];
const MANY_TYPES = Array.from({ length: 12 }, (_, i) => ({
  id: 100 + i,
  name: `CPV: 30${i}`,
  description: `Office machine ${i}`,
}));

const OFFICE_MACHINE_PATTERN = /^Office machine/;
const onTypeChange = jest.fn<(typeId: number) => undefined>();

async function typeQuery(text: string) {
  await fireEvent.changeText(screen.getByLabelText('Choose a product type'), text);
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
}

describe('ProductTypeField', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useRecentCategories.setState({ recents: [] });
    server.use(
      http.get(`${API_URL}/product-types`, ({ request }) => {
        const params = new URL(request.url).searchParams;
        const search = params.get('search')?.toLowerCase();
        const names = params.getAll('name[in]');
        const all = [...PRODUCT_TYPES, ...MANY_TYPES];
        return HttpResponse.json(
          page(
            all.filter((type) =>
              search ? type.description.toLowerCase().includes(search) : names.includes(type.name),
            ),
          ),
        );
      }),
      http.get(`${API_URL}/product-types/77`, () => HttpResponse.json(PRODUCT_TYPES[1])),
    );
  });

  const renderField = (typeID?: number) =>
    renderWithProviders(
      <ProductTypeField typeID={typeID} entityRole="product" onTypeChange={onTypeChange} />,
      { withDialog: true },
    );

  it('picks a type from what the search matches and clears the field', async () => {
    await renderField();
    await typeQuery('petrol');

    await fireEvent.press(await screen.findByRole('button', { name: 'Petroleum products' }));

    await waitFor(() => expect(onTypeChange).toHaveBeenCalledWith(77));
    expect(screen.getByLabelText('Choose a product type').props.value).toBe('');
    // The matches go at once, not after the 300 ms debounce: a second tap must not pick again.
    expect(screen.queryByText('1 match')).toBeNull();
    // What is left is the new recent, offered as a suggestion.
    expect(screen.getAllByRole('button', { name: 'Petroleum products' })).toHaveLength(1);
    expect(screen.getByText('Suggestions')).toBeOnTheScreen();
    expect(useRecentCategories.getState().recents.map((c) => c.name)).toEqual(['CPV: 09']);
  });

  it('says when nothing matches and points to browsing', async () => {
    await renderField();
    await typeQuery('zeppelin');

    expect(
      await screen.findByText('No type matches “zeppelin”. Try a broader word, or browse.'),
    ).toBeOnTheScreen();
  });

  it('shows the first 8 matches and asks for a narrower word', async () => {
    await renderField();
    await typeQuery('office');

    expect(
      await screen.findByText('First 8 of 12 matches. Keep typing to narrow them down.'),
    ).toBeOnTheScreen();
    expect(screen.getAllByText(OFFICE_MACHINE_PATTERN)).toHaveLength(8);
  });

  it('keeps the field and says so when the picked type has no row', async () => {
    server.use(http.get(`${API_URL}/product-types`, () => HttpResponse.json(page([]))));
    useRecentCategories.setState({ recents: [{ ...PRODUCT_TYPES[1], childCount: 0 }] });
    await renderField();

    await fireEvent.press(await screen.findByRole('button', { name: 'Petroleum products' }));

    expect(await screen.findByText("Couldn't select that type. Try again.")).toBeOnTheScreen();
    expect(onTypeChange).not.toHaveBeenCalled();
  });

  it('offers recent picks before a type is set, and not after', async () => {
    useRecentCategories.setState({ recents: [{ ...PRODUCT_TYPES[1], childCount: 0 }] });
    await renderField();
    expect(await screen.findByText('Suggestions')).toBeOnTheScreen();

    await renderField(77);
    // The set type shows as its card, and no shortcut list sits under it.
    expect(await screen.findByText('Petroleum products')).toBeOnTheScreen();
    expect(screen.queryByText('Suggestions')).toBeNull();
    expect(screen.getByLabelText('Change Product type')).toBeOnTheScreen();
  });

  it('opens the category browser and takes a pick from it', async () => {
    server.use(
      http.get(`${API_URL}/categories/tree`, () =>
        HttpResponse.json(
          page([{ id: 2, name: 'Petroleum products', external_id: '09000000', subcategories: [] }]),
        ),
      ),
    );
    await renderField();

    await fireEvent.press(screen.getByText('Browse categories'));
    await fireEvent.press(await screen.findByLabelText('Petroleum products, CPV: 09'));

    await waitFor(() => expect(onTypeChange).toHaveBeenCalledWith(77));
    expect(onTypeChange).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Close' })).toBeNull());
  });

  it('returns native screen-reader focus to the Browse button when the browser closes', async () => {
    mockPlatform('ios');
    const sendEvent = jest
      .spyOn(AccessibilityInfo, 'sendAccessibilityEvent')
      .mockImplementation(() => {});
    try {
      await renderField();

      await fireEvent.press(screen.getByText('Browse categories'));
      await fireEvent.press(await screen.findByRole('button', { name: 'Close' }));

      await waitFor(() => expect(sendEvent).toHaveBeenCalledWith(expect.anything(), 'focus'));
    } finally {
      sendEvent.mockRestore();
      restorePlatform();
    }
  });

  it('takes one pick while the first lookup is still running', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(`${API_URL}/product-types`, async ({ request }) => {
        const names = new URL(request.url).searchParams.getAll('name[in]');
        await gate;
        return HttpResponse.json(page(PRODUCT_TYPES.filter((t) => names.includes(t.name))));
      }),
    );
    const { result } = await renderHook(() => usePickProductType(onTypeChange));

    await act(async () => {
      const first = result.current.pick({ ...PRODUCT_TYPES[0], childCount: 0 });
      const second = result.current.pick({ ...PRODUCT_TYPES[2], childCount: 0 });
      release();
      await Promise.all([first, second]);
    });

    expect(onTypeChange).toHaveBeenCalledWith(66);
    expect(onTypeChange).toHaveBeenCalledTimes(1);
  });

  it('drops a pick whose lookup resolves after its list closed', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(`${API_URL}/product-types`, async () => {
        await gate;
        return HttpResponse.json(page(PRODUCT_TYPES));
      }),
    );
    const { result, unmount } = await renderHook(() => usePickProductType(onTypeChange));

    let pending: Promise<void> = Promise.resolve();
    await act(async () => {
      pending = result.current.pick({ ...PRODUCT_TYPES[1], childCount: 0 });
    });
    await unmount();
    release();
    await pending;

    expect(onTypeChange).not.toHaveBeenCalled();
    expect(useRecentCategories.getState().recents).toEqual([]);
  });

  it('does not record a pick its list declined as recent', async () => {
    const { result } = await renderHook(() => usePickProductType(() => false));

    await act(async () => {
      await result.current.pick({ ...PRODUCT_TYPES[1], childCount: 0 });
    });

    expect(useRecentCategories.getState().recents).toEqual([]);
  });

  it('labels a type without a description by its name', async () => {
    server.use(
      http.get(`${API_URL}/product-types`, () =>
        HttpResponse.json(page([{ id: 5, name: 'Laptop', description: null }])),
      ),
    );
    await renderField();
    await typeQuery('lap');

    const option = await screen.findByRole('button', { name: 'Laptop' });
    expect(option.props.accessibilityLabel).toBe('Laptop');
  });

  it('drops the last matches as soon as a new word is typed after a pick', async () => {
    await renderField();
    await typeQuery('petrol');
    await fireEvent.press(await screen.findByRole('button', { name: 'Petroleum products' }));
    await waitFor(() => expect(onTypeChange).toHaveBeenCalled());

    // Inside the 300 ms debounce: the debounced query still says "petrol".
    await fireEvent.changeText(screen.getByLabelText('Choose a product type'), 'agr');

    expect(screen.queryByRole('button', { name: 'Petroleum products' })).toBeNull();
  });

  it('clears a failed pick message once you type again', async () => {
    server.use(http.get(`${API_URL}/product-types`, () => HttpResponse.json(page([]))));
    useRecentCategories.setState({ recents: [{ ...PRODUCT_TYPES[1], childCount: 0 }] });
    await renderField();
    await fireEvent.press(await screen.findByRole('button', { name: 'Petroleum products' }));
    await screen.findByText("Couldn't select that type. Try again.");

    await fireEvent.changeText(screen.getByLabelText('Choose a product type'), 'a');

    expect(screen.queryByText("Couldn't select that type. Try again.")).toBeNull();
  });

  it('does not show the last matches under a new, unrelated word', async () => {
    await renderField();
    await typeQuery('petrol');
    await fireEvent.press(await screen.findByRole('button', { name: 'Petroleum products' }));
    await waitFor(() => expect(onTypeChange).toHaveBeenCalled());
    server.use(
      http.get(`${API_URL}/product-types`, async () => {
        await delay(1000);
        return HttpResponse.json(page([]));
      }),
    );

    await typeQuery('agri');

    expect(screen.queryByRole('button', { name: 'Petroleum products' })).toBeNull();
  });
});
