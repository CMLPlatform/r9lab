import { beforeEach, describe, expect, it } from '@jest/globals';
import { act, screen } from '@testing-library/react-native';
import { HttpResponse, http } from 'msw';
import ProductType from '@/components/product/detail/ProductType';
import { API_URL } from '@/config';
import { baseProduct as _base, renderWithProviders } from '@/test-utils/index';
import { server } from '@/test-utils/server';
import type { Product } from '@/types/Product';

const baseProduct: Product = { ..._base, productTypeID: undefined };

describe('ProductType', () => {
  beforeEach(() => {
    server.use(
      http.get(`${API_URL}/product-types/1`, () =>
        HttpResponse.json({ id: 1, name: '03000000-1', description: 'Agricultural products' }),
      ),
    );
  });

  // Only a component can be a material, so the row is labelled by role.
  it('labels the type row "Product type" for a product', async () => {
    await renderWithProviders(<ProductType product={baseProduct} editMode={true} />);
    expect(await screen.findByText('Product type')).toBeOnTheScreen();
    expect(screen.getByLabelText('Choose a product type')).toBeOnTheScreen();
    expect(screen.queryByText('Component type or material')).toBeNull();
  });

  it('labels the type row "Component type or material" for a component', async () => {
    const component = { ...baseProduct, role: 'component' as const, parentID: 1 };
    await renderWithProviders(<ProductType product={component} editMode={true} />);
    expect(await screen.findByText('Component type or material')).toBeOnTheScreen();
    expect(screen.getByLabelText('Choose component type or material')).toBeOnTheScreen();
    expect(screen.queryByText('Select a fitting category for the product.')).toBeNull();
  });

  // A typeless product must never show a placeholder error card as its first impression.
  it('shows an inviting empty state instead of the undefined category card when no type is picked', async () => {
    await renderWithProviders(<ProductType product={baseProduct} editMode={true} />);
    expect(await screen.findByLabelText('Choose a product type')).toBeOnTheScreen();
    expect(screen.queryByText('Category undefined')).toBeNull();
  });

  it('renders nothing for a typeless product in view mode', async () => {
    const { queryByText } = await renderWithProviders(
      <ProductType product={baseProduct} editMode={false} />,
    );
    await act(async () => {});
    expect(queryByText('Product type')).toBeNull();
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

  // No card nested in the Overview card: view mode states the type as a spec fact.
  it('hides the "view all" link in editMode', async () => {
    const product = { ...baseProduct, productTypeID: 1, productTypeName: '03000000-1' };
    await renderWithProviders(<ProductType product={product} editMode={true} />);
    await screen.findByText('Agricultural products');
    expect(screen.queryByLabelText('View all products of type 03000000-1')).toBeNull();
  });
});
