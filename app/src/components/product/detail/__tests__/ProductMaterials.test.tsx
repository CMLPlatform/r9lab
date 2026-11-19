import { describe, expect, it } from '@jest/globals';
import { screen } from '@testing-library/react-native';
import { HttpResponse, http } from 'msw';
import ProductMaterials from '@/components/product/detail/ProductMaterials';
import { API_URL } from '@/config';
import {
  baseProduct,
  renderWithProviders as renderWithProvidersBase,
  server,
} from '@/test-utils/index';
import type { Product, ProductMaterial } from '@/types/Product';

const aluminum: ProductMaterial = {
  materialID: 7,
  name: 'Aluminum',
  quantity: 0.5,
  unit: 'kg',
  source: 'https://example.com/aluminum',
};

// The edit controls report failures through the dialog.
const render = (ui: React.ReactElement) => renderWithProvidersBase(ui, { withDialog: true });

function withMaterials(materials: Product['materials']): Product {
  return { ...baseProduct, materials };
}

describe('ProductMaterials', () => {
  // A heading like its Measurements and Circularity notes siblings, not a toggle.
  it('shows the heading and a dash when nothing is recorded', async () => {
    await render(<ProductMaterials product={withMaterials([])} />);

    expect(screen.getByRole('header', { name: 'Materials' })).toBeOnTheScreen();
    expect(screen.getByText('—')).toBeOnTheScreen();
    expect(screen.queryByText('(0)')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  // A saved record offers its first row.
  it('offers an add-row for an empty list on a saved record', async () => {
    await render(<ProductMaterials product={withMaterials([])} editMode />);

    expect(screen.getByText('Add material')).toBeOnTheScreen();
  });

  // An unsaved draft has no id to record against.
  it('hides an empty list on an unsaved draft', async () => {
    await render(
      <ProductMaterials
        product={{ ...withMaterials([]), id: 'new' as unknown as number }}
        editMode
      />,
    );

    expect(screen.queryByText('Materials')).toBeNull();
  });

  it('keeps recorded materials in edit mode', async () => {
    server.use(
      http.get(`${API_URL}/products/:id/materials`, () =>
        HttpResponse.json([
          {
            material_id: aluminum.materialID,
            quantity: aluminum.quantity,
            unit: aluminum.unit,
            material: { id: aluminum.materialID, name: aluminum.name },
          },
        ]),
      ),
    );
    await render(<ProductMaterials product={withMaterials([aluminum])} editMode />);

    expect(screen.getByRole('header', { name: 'Materials' })).toBeOnTheScreen();
    expect(screen.getByText('Aluminum')).toBeOnTheScreen();
  });

  it('lists the recorded quantity, unit and material reference', async () => {
    await render(<ProductMaterials product={withMaterials([aluminum])} />);

    expect(screen.getByRole('header', { name: 'Materials' })).toBeOnTheScreen();
    expect(screen.getByText('(1)')).toBeOnTheScreen();
    expect(screen.getByText('Aluminum')).toBeOnTheScreen();
    expect(screen.getByText('0.5 kg')).toBeOnTheScreen();
    expect(screen.getByText('Material reference: https://example.com/aluminum')).toBeOnTheScreen();
  });

  // Uncertainty is data: a missing reference is stated plainly, never as a warning.
  it('states a missing material reference without flagging it', async () => {
    await render(
      <ProductMaterials product={withMaterials([{ ...aluminum, source: undefined }])} />,
    );

    expect(screen.getByText('No reference recorded.')).toBeOnTheScreen();
  });

  it('renders nothing for a record whose materials were never loaded', async () => {
    await render(<ProductMaterials product={withMaterials(undefined)} />);

    expect(screen.queryByText('Materials')).toBeNull();
  });
});
