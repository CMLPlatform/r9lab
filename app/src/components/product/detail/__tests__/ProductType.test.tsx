import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, screen, waitFor } from '@testing-library/react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { HttpResponse, http } from 'msw';
import ProductType from '@/components/product/detail/ProductType';
import { API_URL } from '@/config';
import { takePendingTypeSelection } from '@/features/products/pendingTypeSelection';
import { baseProduct as _base, renderWithProviders, setupUser } from '@/test-utils/index';
import { server } from '@/test-utils/server';
import type { Product } from '@/types/Product';

jest.mock('@/features/products/pendingTypeSelection', () => ({
  takePendingTypeSelection: jest.fn(),
  setPendingTypeSelection: jest.fn(),
}));

const mockPush = jest.fn();
const mockSetParams = jest.fn();
const mockedTakePending = jest.mocked(takePendingTypeSelection);

const baseProduct: Product = { ..._base, productTypeID: undefined };

describe('ProductType', () => {
  const user = setupUser();

  beforeEach(() => {
    mockPush.mockReset();
    mockSetParams.mockReset();
    server.use(
      http.get(`${API_URL}/product-types/1`, () =>
        HttpResponse.json({ id: 1, name: '03000000-1', description: 'Agricultural products' }),
      ),
    );
    mockedTakePending.mockReturnValue(null);
    (useFocusEffect as jest.Mock).mockReset();
    (useRouter as jest.Mock).mockReturnValue({
      push: mockPush,
      replace: jest.fn(),
      back: jest.fn(),
      setParams: mockSetParams,
    });
  });

  // Only a component can be a material, so the row is labelled by role.
  it('labels the type row "Product type" for a product', async () => {
    await renderWithProviders(<ProductType product={baseProduct} editMode={true} />);
    expect(await screen.findByText('Product type')).toBeOnTheScreen();
    expect(screen.getByText('Choose a product type')).toBeOnTheScreen();
    expect(screen.queryByText('Component type or material')).toBeNull();
  });

  it('labels the type row "Component type or material" for a component', async () => {
    const component = { ...baseProduct, role: 'component' as const, parentID: 1 };
    await renderWithProviders(<ProductType product={component} editMode={true} />);
    expect(await screen.findByText('Component type or material')).toBeOnTheScreen();
    expect(screen.getByText('Choose component type or material')).toBeOnTheScreen();
    expect(screen.queryByText('Select a fitting category for the product.')).toBeNull();
  });

  // A typeless product must never show a placeholder error card as its first impression.
  it('shows an inviting empty state instead of the undefined category card when no type is picked', async () => {
    await renderWithProviders(<ProductType product={baseProduct} editMode={true} />);
    expect(await screen.findByText('Choose a product type')).toBeOnTheScreen();
    expect(screen.queryByText('Category undefined')).toBeNull();
  });

  it('renders nothing for a typeless product in view mode', async () => {
    const { queryByText } = await renderWithProviders(
      <ProductType product={baseProduct} editMode={false} />,
    );
    await act(async () => {});
    expect(queryByText('Product type')).toBeNull();
    expect(queryByText('Choose a product type')).toBeNull();
    expect(queryByText('Category undefined')).toBeNull();
  });

  // A type picked since load is fetched by its database id; the stale recorded one is ignored.
  it('shows a type picked since load from the API, not the stale recorded one', async () => {
    const product = {
      ...baseProduct,
      productTypeID: 1,
      productType: { id: 3, name: 'Display module', description: 'A screen assembly.' },
    };
    await renderWithProviders(<ProductType product={product} editMode={true} />);
    expect(await screen.findByText('Agricultural products')).toBeOnTheScreen();
    expect(screen.queryByText('Display module')).toBeNull();
  });

  // The tooltip is an instruction to pick a type, which a viewer cannot do.
  // View mode states the type in OverviewFacts; this component is the edit control only.
  it('renders nothing in view mode', async () => {
    const product = { ...baseProduct, productTypeID: 1 };
    await renderWithProviders(<ProductType product={product} editMode={false} />);
    await act(async () => {});
    expect(screen.queryByText('Product type')).toBeNull();
    expect(screen.queryByText('Agricultural products')).toBeNull();
  });

  it('offers the category tooltip in edit mode', async () => {
    const product = { ...baseProduct, productTypeID: 1 };
    await renderWithProviders(<ProductType product={product} editMode={true} />);
    expect(
      await screen.findByLabelText('Info: Select a fitting category for the product.'),
    ).toBeOnTheScreen();
  });
  it('renders nothing for an unresolvable type id instead of the undefined error card', async () => {
    const product = { ...baseProduct, productTypeID: 999 };
    await renderWithProviders(<ProductType product={product} editMode={false} />);
    await act(async () => {});
    expect(screen.queryByText('Category undefined')).toBeNull();
  });

  it('applies a pending type selection when the screen regains focus', async () => {
    const onTypeChange = jest.fn();
    // The unit-lane mock is a no-op; make useFocusEffect run its callback so the
    // pending-slot consume path is exercised.
    (useFocusEffect as jest.Mock).mockImplementation((cb: unknown) => (cb as () => void)());
    mockedTakePending.mockReturnValue(123);

    await renderWithProviders(
      <ProductType product={baseProduct} editMode={false} onTypeChange={onTypeChange} />,
    );

    await waitFor(() => {
      expect(onTypeChange).toHaveBeenCalledWith(123);
    });
  });

  it('navigates to category selection on press in editMode', async () => {
    await renderWithProviders(<ProductType product={baseProduct} editMode={true} />);
    await user.press(await screen.findByText('Choose a product type'));
    expect(mockPush).toHaveBeenCalledWith('/category-selection');
  });

  // The picker must open for unsaved drafts (no numeric id), or a new product
  // can never set its type before the first save.
  it('opens the picker for an unsaved draft (no id) in editMode', async () => {
    const draft = { ...baseProduct, id: undefined } as unknown as Product;
    await renderWithProviders(<ProductType product={draft} editMode={true} />);
    await user.press(await screen.findByText('Choose a product type'));
    expect(mockPush).toHaveBeenCalledWith('/category-selection');
  });

  // No card nested in the Overview card: view mode states the type as a spec fact.
  it('hides the "view all" link in editMode', async () => {
    const product = { ...baseProduct, productTypeID: 1, productTypeName: '03000000-1' };
    await renderWithProviders(<ProductType product={product} editMode={true} />);
    await screen.findByText('Agricultural products');
    expect(screen.queryByLabelText('View all products of type 03000000-1')).toBeNull();
  });
});
