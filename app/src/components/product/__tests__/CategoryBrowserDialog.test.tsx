import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { delay, HttpResponse, http } from 'msw';
import { StyleSheet } from 'react-native';
import { CategoryBrowserDialog } from '@/components/product/CategoryBrowserDialog';
import { API_URL } from '@/config';
import { MIN_TAP_TARGET } from '@/constants';
import { useCategorySelection } from '@/features/products/useCategorySelection';
import { useRecentCategories } from '@/features/products/useRecentCategories';
import { mockPlatform, renderWithProviders, restorePlatform } from '@/test-utils/index';
import { server } from '@/test-utils/server';

const mockSelect = jest.fn();
const mockDismiss = jest.fn();
const SUBCATEGORY_COUNT_PATTERN = /1 subcategor/;
const TYPING_NOW_PATTERN = /typing-now/;
const BLURB_PATTERN = /Type a name \(e\.g\. laptop\) to search every category/;
const INFO_TOOLTIP_LABEL_PATTERN = /Info: Product types come from/;

// Every other test in this file exercises the real hook (the API stubbed with
// MSW) end to end, so wrap (don't replace) it: jest.fn() defaults to calling
// straight through to the real implementation, and only the one test below
// overrides it (mockReturnValueOnce, self-restoring) to force a searchQuery
// vs debouncedSearchQuery mismatch that the real 300ms debounce makes
// impractical to hit deterministically in a DOM test.
jest.mock('@/features/products/useCategorySelection', () => ({
  useCategorySelection: jest.fn(
    jest.requireActual<typeof import('@/features/products/useCategorySelection')>(
      '@/features/products/useCategorySelection',
    ).useCategorySelection,
  ),
}));

const renderBrowser = () =>
  renderWithProviders(
    <CategoryBrowserDialog visible onDismiss={mockDismiss} onSelect={mockSelect} />,
  );

const PETROLEUM_RECENT = {
  id: 2,
  name: 'CPV: 09',
  description: 'Petroleum products',
  childCount: 0,
};

// The tree API returns the padded CPV code in external_id; the product type row
// stores it trimmed as `CPV: <code>` under a database id of its own.
const treeNode = (id: number, externalId: string, name: string, subcategories: unknown[] = []) => ({
  id,
  name,
  external_id: externalId,
  subcategories,
});
const AGRI_CHILD = treeNode(3, '03100000', 'Agricultural and horticultural products');
// The API's paginated envelope.
const page = (items: unknown[]) => ({ items, page: 1, pages: 1, size: 100, total: items.length });
const PRODUCT_TYPES = [
  { id: 66, name: 'CPV: 03', description: 'Agricultural products' },
  { id: 77, name: 'CPV: 09', description: 'Petroleum products' },
  { id: 88, name: 'CPV: 031', description: 'Agricultural and horticultural products' },
];

describe('CategoryBrowserDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // The recents store is a module-level singleton (zustand), so it outlives
    // any single test's render; reset it here rather than letting one test's
    // recordRecent leak a duplicate "Petroleum products" node into the next.
    useRecentCategories.setState({ recents: [] });
    server.use(
      http.get(`${API_URL}/categories/tree`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('taxonomy_name[ilike]')).toBe(
          'Common Procurement Vocabulary (CPV)',
        );
        expect(url.searchParams.get('size')).toBe('100');
        return HttpResponse.json(
          page([
            treeNode(1, '03000000', 'Agricultural products', [AGRI_CHILD]),
            treeNode(2, '09000000', 'Petroleum products'),
          ]),
        );
      }),
      http.get(`${API_URL}/categories/1/subcategories/tree`, () =>
        HttpResponse.json(page([AGRI_CHILD])),
      ),
      http.get(`${API_URL}/product-types`, ({ request }) => {
        const params = new URL(request.url).searchParams;
        const search = params.get('search')?.toLowerCase();
        const names = params.getAll('name[in]');
        return HttpResponse.json(
          page(
            PRODUCT_TYPES.filter((type) =>
              search ? type.description.toLowerCase().includes(search) : names.includes(type.name),
            ),
          ),
        );
      }),
    );
  });

  it('titles the dialog with a level 2 heading on web', async () => {
    mockPlatform('web');
    try {
      await renderBrowser();
      const title = await screen.findByText('Browse categories');
      expect(title.props['aria-level']).toBe(2);
    } finally {
      restorePlatform();
    }
  });

  it('starts each opening at the root with an empty search', async () => {
    const view = await renderBrowser();
    await fireEvent.press(await screen.findByText('1 subcategories'));
    await screen.findByText('Agricultural and horticultural products');
    await fireEvent.changeText(screen.getByPlaceholderText('Search'), 'petrol');

    await view.rerender(
      <CategoryBrowserDialog visible={false} onDismiss={mockDismiss} onSelect={mockSelect} />,
    );
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    await view.rerender(
      <CategoryBrowserDialog visible onDismiss={mockDismiss} onSelect={mockSelect} />,
    );

    expect(await screen.findByText('Petroleum products')).toBeOnTheScreen();
    expect(screen.getByPlaceholderText('Search').props.value).toBe('');
    expect(screen.queryByRole('button', { name: 'Go back to parent category' })).toBeNull();
  });

  it('closes from its Close button without picking', async () => {
    await renderBrowser();
    await fireEvent.press(await screen.findByText('Close'));
    expect(mockDismiss).toHaveBeenCalled();
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('shows a retryable error instead of spinning when the category list fails to load', async () => {
    server.use(http.get(`${API_URL}/categories/tree`, () => HttpResponse.error(), { once: true }));
    await renderBrowser();

    expect(await screen.findByText("Couldn't load the category list.")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Retry'));
    expect(await screen.findByText('Agricultural products')).toBeOnTheScreen();
  });

  it('renders root category items initially', async () => {
    await renderBrowser();
    await waitFor(() => {
      expect(screen.getByText('Agricultural products')).toBeOnTheScreen();
      expect(screen.getByText('Petroleum products')).toBeOnTheScreen();
    });
  });

  it('hands the picked type on and closes when a leaf is pressed', async () => {
    await renderBrowser();
    await screen.findByText('Petroleum products');
    await fireEvent.press(screen.getByText('Petroleum products'));
    await waitFor(() => {
      expect(mockSelect).toHaveBeenCalledWith(77);
      expect(mockDismiss).toHaveBeenCalled();
    });
  });

  it('stays on the picker with an error when the database has no row for the pick', async () => {
    server.use(http.get(`${API_URL}/product-types`, () => HttpResponse.json({ items: [] })));
    await renderBrowser();
    await fireEvent.press(await screen.findByText('Petroleum products'));

    expect(await screen.findByText("Couldn't select that type. Try again.")).toBeOnTheScreen();
    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockDismiss).not.toHaveBeenCalled();
  });

  it('stays on the picker with an error when the lookup request fails', async () => {
    server.use(http.get(`${API_URL}/product-types`, () => HttpResponse.error()));
    await renderBrowser();
    await fireEvent.press(await screen.findByText('Petroleum products'));

    expect(await screen.findByText("Couldn't select that type. Try again.")).toBeOnTheScreen();
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('navigates into subcategory when subcategories button is pressed', async () => {
    await renderBrowser();
    // Agricultural products has 1 subcategory; shows "1 subcategories" link
    await waitFor(() => {
      expect(screen.getByText(SUBCATEGORY_COUNT_PATTERN)).toBeOnTheScreen();
    });
    await fireEvent.press(screen.getByText('1 subcategories'));
    await waitFor(() => {
      expect(screen.getByText('Agricultural and horticultural products')).toBeOnTheScreen();
    });
  });

  it('shows history breadcrumb after navigating into subcategory', async () => {
    await renderBrowser();
    await screen.findByText('1 subcategories');
    await fireEvent.press(screen.getByText('1 subcategories'));
    await waitFor(() => {
      expect(screen.getByText('Agricultural products')).toBeOnTheScreen();
    });
  });

  it('pressing the history breadcrumb navigates back up to the parent level', async () => {
    await renderBrowser();
    await screen.findByText('1 subcategories');
    await fireEvent.press(screen.getByText('1 subcategories'));
    // Now inside Agricultural products; breadcrumb shows
    await waitFor(() => {
      expect(screen.getByText('Agricultural products')).toBeOnTheScreen();
    });
    // Pressing the breadcrumb triggers moveUp; root categories re-appear
    await fireEvent.press(screen.getByText('Agricultural products'));
    await waitFor(() => {
      expect(screen.getByText('Petroleum products')).toBeOnTheScreen();
    });
  });

  it('shows a Recent section above the list at the root when there are recent picks', async () => {
    useRecentCategories.setState({ recents: [PETROLEUM_RECENT] });
    await renderBrowser();
    await screen.findByText('Agricultural products');

    expect(screen.getByText('Recent')).toBeOnTheScreen();
    // Once for the recents card, once for the same item in the root list.
    expect(screen.getAllByText('Petroleum products')).toHaveLength(2);
  });

  it('omits the Recent section when there are no recent picks', async () => {
    await renderBrowser();
    await screen.findByText('Agricultural products');

    expect(screen.queryByText('Recent')).toBeNull();
  });

  it('hides the Recent section once a search is active', async () => {
    useRecentCategories.setState({ recents: [PETROLEUM_RECENT] });
    await renderBrowser();
    await screen.findByText('Recent');

    await fireEvent.changeText(screen.getByPlaceholderText('Search'), 'agri');

    await waitFor(() => {
      expect(screen.queryByText('Recent')).toBeNull();
    });
  });

  it('hides the Recent section once browsed into a subcategory', async () => {
    useRecentCategories.setState({ recents: [PETROLEUM_RECENT] });
    await renderBrowser();
    await screen.findByText('1 subcategories');

    await fireEvent.press(screen.getByText('1 subcategories'));

    await waitFor(() => {
      expect(screen.queryByText('Recent')).toBeNull();
    });
  });

  it('selecting a recent category hands it on like a normal pick', async () => {
    useRecentCategories.setState({ recents: [PETROLEUM_RECENT] });
    await renderBrowser();
    await screen.findByText('Recent');

    await fireEvent.press(screen.getAllByText('Petroleum products')[0]);

    await waitFor(() => {
      expect(mockSelect).toHaveBeenCalledWith(77);
      expect(mockDismiss).toHaveBeenCalled();
    });
  });

  it('records the picked category as a recent when a leaf is selected', async () => {
    await renderBrowser();
    await screen.findByText('Petroleum products');

    await fireEvent.press(screen.getByText('Petroleum products'));

    await waitFor(() => {
      expect(useRecentCategories.getState().recents.map((c) => c.name)).toEqual(['CPV: 09']);
    });
  });

  it('keys recents by stored name, so ids from different sources cannot collide', async () => {
    // A category id and a product type id can be equal; both cards must render.
    useRecentCategories.setState({
      recents: [
        { id: 2, name: 'CPV: 09', description: 'Petroleum products', childCount: 0 },
        { id: 2, name: 'CPV: 03', description: 'Old bundle entry', childCount: 0 },
      ],
    });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await renderBrowser();
    await screen.findByText('Recent');
    expect(screen.getByText('Old bundle entry')).toBeOnTheScreen();
    // React logs "two children with the same key" when ids collide.
    expect(errorSpy.mock.calls.flat().join(' ')).not.toContain('same key');
    errorSpy.mockRestore();
  });

  it('keeps the previous results on screen while the next search loads', async () => {
    await renderBrowser();
    await screen.findByPlaceholderText('Search');
    await fireEvent.changeText(screen.getByPlaceholderText('Search'), 'petroleum');
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    await screen.findByText('Petroleum products');
    server.use(
      http.get(`${API_URL}/product-types`, async () => {
        await delay(1000);
        return HttpResponse.json(page([]));
      }),
    );
    await fireEvent.changeText(screen.getByPlaceholderText('Search'), 'petroleum p');
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    expect(screen.getByText('Petroleum products')).toBeOnTheScreen();
  });

  it('words a failed search as a search error, not a category list error', async () => {
    server.use(http.get(`${API_URL}/product-types`, () => HttpResponse.error()));
    await renderBrowser();
    await screen.findByPlaceholderText('Search');
    await fireEvent.changeText(screen.getByPlaceholderText('Search'), 'petroleum');
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    expect(await screen.findByText("Couldn't search the categories.")).toBeOnTheScreen();
  });

  it('shows the plain-language blurb and contextual CPV help tooltip', async () => {
    await renderBrowser();
    await screen.findByPlaceholderText('Search');
    expect(screen.getByText(BLURB_PATTERN)).toBeOnTheScreen();
    expect(screen.getByLabelText(INFO_TOOLTIP_LABEL_PATTERN)).toBeOnTheScreen();
  });

  it('meets the 44px tap-target floor on the subcategories link and history breadcrumb', async () => {
    await renderBrowser();
    const linkButton = await screen.findByRole('button', { name: 'Browse 1 subcategories' });
    expect(StyleSheet.flatten(linkButton.props.style).minHeight).toBe(MIN_TAP_TARGET);

    await fireEvent.press(linkButton);
    const historyButton = await screen.findByRole('button', {
      name: 'Go back to parent category',
    });
    expect(StyleSheet.flatten(historyButton.props.style).minHeight).toBe(MIN_TAP_TARGET);
  });

  it('focuses the search field on open', async () => {
    await renderBrowser();
    expect((await screen.findByPlaceholderText('Search')).props.autoFocus).toBe(true);
  });

  it('search matches nested leaves from the root, not just the current level', async () => {
    await renderBrowser();
    await screen.findByPlaceholderText('Search');
    await fireEvent.changeText(screen.getByPlaceholderText('Search'), 'horticultural');
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    expect(await screen.findByText('Agricultural and horticultural products')).toBeOnTheScreen();
    expect(screen.queryByText('Petroleum products')).toBeNull();
  });

  it('search covers the whole tree even when browsed into a branch', async () => {
    await renderBrowser();
    await fireEvent.press(await screen.findByText('1 subcategories'));
    await screen.findByText('Agricultural and horticultural products');
    await fireEvent.changeText(screen.getByPlaceholderText('Search'), 'petroleum');
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    expect(await screen.findByText('Petroleum products')).toBeOnTheScreen();
  });

  it('lists the most-used types under "Common types" above the tree', async () => {
    server.use(
      http.get(`${API_URL}/stats/categories`, () =>
        HttpResponse.json({
          generated_at: '',
          limit: 10,
          scope: 'all',
          categories: [
            { name: 'CPV: 031', count: 7 },
            { name: 'not-in-cpv', count: 3 },
          ],
        }),
      ),
    );
    await renderBrowser();

    await screen.findByText('Common types');
    // The nested leaf appears in the shortcut even though the root list does not show it.
    expect(screen.getByText('Agricultural and horticultural products')).toBeOnTheScreen();
    expect(screen.getByText('All categories')).toBeOnTheScreen();

    await fireEvent.press(screen.getByText('Agricultural and horticultural products'));
    await waitFor(() => {
      expect(mockSelect).toHaveBeenCalledWith(88);
    });
  });

  it('omits "Common types" when stats report nothing', async () => {
    await renderBrowser();
    await screen.findByText('Agricultural products');
    expect(screen.queryByText('Common types')).toBeNull();
  });

  it('filters categories by search query', async () => {
    await renderBrowser();
    await screen.findByPlaceholderText('Search');
    await fireEvent.changeText(screen.getByPlaceholderText('Search'), 'petroleum');
    // Step the 300ms debounce off the fake clock instead of letting waitFor poll
    // for it. Polling costs seconds in this one test where every sibling here
    // runs in milliseconds, and it crossed the per-test budget on CI hardware.
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    expect(await screen.findByText('Petroleum products')).toBeOnTheScreen();
    expect(screen.queryByText('Agricultural products')).toBeNull();
  });

  it('shows an empty state when the search query matches nothing', async () => {
    await renderBrowser();
    await screen.findByPlaceholderText('Search');
    await fireEvent.changeText(screen.getByPlaceholderText('Search'), 'nonexistent-widget');
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    await waitFor(() => {
      expect(
        screen.getByText('No categories match “nonexistent-widget”. Try a broader term.'),
      ).toBeOnTheScreen();
    });
  });

  // While the 300ms debounce is still catching up to a keystroke, `filtered`
  // (computed from debouncedSearchQuery) can legitimately lag behind the
  // input's immediate searchQuery. Force that mismatch directly rather than
  // timing the real debounce, and assert the empty-state message quotes the
  // query `filtered` was actually computed from.
  it('quotes the debounced query, not the in-flight keystroke, in the empty state', async () => {
    (useCategorySelection as jest.Mock).mockReturnValueOnce({
      history: [],
      filtered: [],
      loading: false,
      loadFailed: false,
      retryLoad: jest.fn(),
      pickFailed: false,
      commonTypes: [],
      recents: [],
      searchQuery: 'typing-now',
      debouncedSearchQuery: 'typing',
      setSearchQuery: jest.fn(),
      selectBranch: jest.fn(),
      moveUp: jest.fn(),
      pick: jest.fn(),
    });

    await renderBrowser();

    expect(screen.getByText('No categories match “typing”. Try a broader term.')).toBeOnTheScreen();
    expect(screen.queryByText(TYPING_NOW_PATTERN)).toBeNull();
  });
});
