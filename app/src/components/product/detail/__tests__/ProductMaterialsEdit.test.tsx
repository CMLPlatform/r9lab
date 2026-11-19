import { describe, expect, it } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { HttpResponse, http } from 'msw';
import ProductMaterials from '@/components/product/detail/ProductMaterials';
import { API_URL } from '@/config';
import { baseProduct, renderWithProviders, server, setupUser } from '@/test-utils/index';
import type { Product, ProductMaterial } from '@/types/Product';

const MASS_GAP = /differ by more than 10%/;
const NO_TOTAL = /Total mass not available/;
const NEEDS_ANY = /Add materials or components/;

const aluminum: ProductMaterial = { materialID: 7, name: 'Aluminum', quantity: 800, unit: 'g' };
const copper = { id: 9, name: 'Copper', description: 'Conductive wiring metal' };

function link(material: ProductMaterial) {
  return {
    material_id: material.materialID,
    quantity: material.quantity,
    unit: material.unit,
    material: { id: material.materialID, name: material.name },
  };
}

function bill(materials: ProductMaterial[]): Product {
  return { ...baseProduct, components: [], materials };
}

function serveMaterials(options = [copper]) {
  server.use(
    http.get(`${API_URL}/materials`, () =>
      HttpResponse.json({ items: options, total: options.length, page: 1, size: 100, pages: 1 }),
    ),
  );
}

async function renderEdit(product: Product) {
  // Edit mode reads the list from the server, so it must agree with the product.
  server.use(
    http.get(`${API_URL}/:root/:id/materials`, () =>
      HttpResponse.json((product.materials ?? []).map(link)),
    ),
  );
  return renderWithProviders(<ProductMaterials product={product} editMode />, {
    withDialog: true,
  });
}

describe('ProductMaterials edit mode', () => {
  const user = setupUser();

  // The quantity field commits on blur, as it does on the spec rows.
  const typeAndBlur = async (input: ReturnType<typeof screen.getByLabelText>, text: string) => {
    await user.clear(input);
    await user.type(input, text);
    fireEvent(input, 'blur');
  };

  it('adds a material picked from the list with a quantity and the default unit', async () => {
    serveMaterials();
    let body: unknown;
    let path = '';
    server.use(
      http.post(`${API_URL}/products/:id/materials/:materialId`, async ({ request }) => {
        body = await request.json();
        path = new URL(request.url).pathname;
        return HttpResponse.json({}, { status: 201 });
      }),
    );
    await renderEdit(bill([aluminum]));

    await user.press(screen.getByText('Add material'));
    await user.type(await screen.findByLabelText('Search materials'), 'wiring');
    await user.press(await screen.findByText('Copper'));
    await typeAndBlur(await screen.findByLabelText('Quantity'), '12');
    await user.press(screen.getByText('Add'));

    await waitFor(() => expect(body).toEqual({ quantity: 12, unit: 'g' }));
    expect(path.endsWith('/products/1/materials/9')).toBe(true);
  });

  it('does not offer a material that is already recorded', async () => {
    serveMaterials([copper, { id: 7, name: 'Aluminum', description: '' }]);
    await renderEdit(bill([aluminum]));

    await user.press(screen.getByText('Add material'));

    expect(await screen.findByText('Copper')).toBeOnTheScreen();
    // Once as the recorded row; a second match would be the picker offering it again.
    expect(screen.getAllByText('Aluminum')).toHaveLength(1);
  });

  it('updates the quantity of a row on blur', async () => {
    let body: unknown;
    server.use(
      http.patch(`${API_URL}/products/:id/materials/:materialId`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({});
      }),
    );
    await renderEdit(bill([aluminum]));

    const input = screen.getByLabelText('Aluminum');
    await typeAndBlur(input, '750');

    await waitFor(() => expect(body).toEqual({ quantity: 750 }));
  });

  it('updates the unit of a row', async () => {
    let body: unknown;
    server.use(
      http.patch(`${API_URL}/products/:id/materials/:materialId`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({});
      }),
    );
    await renderEdit(bill([aluminum]));

    await user.press(screen.getByRole('radio', { name: 'kg' }));

    await waitFor(() => expect(body).toEqual({ unit: 'kg' }));
  });

  it('rejects a zero quantity without sending it', async () => {
    let sent = false;
    server.use(
      http.patch(`${API_URL}/products/:id/materials/:materialId`, () => {
        sent = true;
        return HttpResponse.json({});
      }),
    );
    await renderEdit(bill([aluminum]));

    const input = screen.getByLabelText('Aluminum');
    await typeAndBlur(input, '0');

    expect(await screen.findByText('Enter a quantity above 0.')).toBeOnTheScreen();
    expect(sent).toBe(false);
  });

  it('removes a row, on a component through the component route', async () => {
    let path = '';
    server.use(
      http.delete(`${API_URL}/components/:id/materials/:materialId`, ({ request }) => {
        path = new URL(request.url).pathname;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await renderEdit({ ...bill([aluminum]), id: 5, role: 'component' });

    await user.press(screen.getByRole('button', { name: 'Remove Aluminum' }));

    await waitFor(() => expect(path.endsWith('/components/5/materials/7')).toBe(true));
  });

  it('shows the list the server returns, not the draft copy', async () => {
    server.use(
      http.get(`${API_URL}/:root/:id/materials`, () => HttpResponse.json([link(aluminum)])),
    );
    await renderWithProviders(<ProductMaterials product={bill([])} editMode />, {
      withDialog: true,
    });

    expect(await screen.findByText('Aluminum')).toBeOnTheScreen();
  });

  it('reports a duplicate the server refuses', async () => {
    serveMaterials();
    server.use(
      http.post(`${API_URL}/products/:id/materials/:materialId`, () =>
        HttpResponse.json({ detail: 'Materials with id 9 are already assigned' }, { status: 409 }),
      ),
    );
    await renderEdit(bill([aluminum]));

    await user.press(screen.getByText('Add material'));
    await user.press(await screen.findByText('Copper'));
    await typeAndBlur(await screen.findByLabelText('Quantity'), '3');
    await user.press(screen.getByText('Add'));

    expect(await screen.findByText('Materials with id 9 are already assigned')).toBeOnTheScreen();
  });

  it('offers no editing on a record the user cannot edit', async () => {
    await renderWithProviders(
      <ProductMaterials product={bill([aluminum])} editMode canEdit={false} />,
      { withDialog: true },
    );

    expect(screen.queryByText('Add material')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove Aluminum' })).toBeNull();
  });

  it('offers no editing on an unsaved draft', async () => {
    await renderEdit({ ...bill([]), id: 'new' as unknown as number });

    expect(screen.queryByText('Add material')).toBeNull();
  });
});

describe('ProductMaterials warnings and total', () => {
  it('shows the total mass and warns when it is far from the weight', async () => {
    await renderWithProviders(
      <ProductMaterials product={bill([{ ...aluminum, quantity: 100 }])} />,
      {
        withDialog: true,
      },
    );

    expect(screen.getByText('Total mass: 100 g')).toBeOnTheScreen();
    expect(screen.getByText(MASS_GAP)).toBeOnTheScreen();
  });

  it('says the total is not available when a row is not a mass', async () => {
    await renderWithProviders(
      <ProductMaterials
        product={bill([aluminum, { ...aluminum, materialID: 8, name: 'Wire', unit: 'm' }])}
      />,
      { withDialog: true },
    );

    expect(screen.getByText(NO_TOTAL)).toBeOnTheScreen();
    expect(screen.queryByText(MASS_GAP)).toBeNull();
  });

  it('warns, without blocking, that a saved record has neither materials nor components', async () => {
    await renderWithProviders(<ProductMaterials product={bill([])} />, { withDialog: true });

    expect(screen.getByText(NEEDS_ANY)).toBeOnTheScreen();
  });

  it('says nothing when the mass matches the weight', async () => {
    await renderWithProviders(
      <ProductMaterials product={bill([{ ...aluminum, quantity: 850 }])} />,
      {
        withDialog: true,
      },
    );

    expect(screen.queryByText(MASS_GAP)).toBeNull();
  });
});
