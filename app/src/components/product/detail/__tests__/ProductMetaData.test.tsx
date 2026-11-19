import { describe, expect, it } from '@jest/globals';
import { screen } from '@testing-library/react-native';
import { HttpResponse, http } from 'msw';
import ProductMetaData from '@/components/product/detail/ProductMetaData';
import { API_URL } from '@/config';
import { baseProduct as _base, renderWithProviders, setupUser } from '@/test-utils/index';
import { server } from '@/test-utils/server';
import type { Product } from '@/types/Product';

const baseProduct: Product = { ..._base, id: 42 };
const PRODUCT_ID_PATTERN = /Product ID:/;
const CREATED_PATTERN = /Created:/;
const LAST_UPDATED_PATTERN = /Last updated:/;
const OWNER_PATTERN = /Owner:/;
const ANONYMOUS_PATTERN = /Anonymous/;
const TESTUSER_PATTERN = /testuser/;
const COMPONENT_ID_PATTERN = /Component ID:/;
const MODERATOR_PATTERN = /A moderator/;
const NO_EDITS_PATTERN = /No edits recorded/;
const SHOW_HISTORY_PATTERN = /Show edit history$/;
const HIDE_HISTORY_PATTERN = /Hide edit history$/;

describe('ProductMetaData', () => {
  it('shows the product ID', async () => {
    await renderWithProviders(<ProductMetaData product={baseProduct} />);
    expect(screen.getByText(PRODUCT_ID_PATTERN)).toBeOnTheScreen();
    expect(screen.getByText('42')).toHaveStyle({ fontSize: 14 });
  });

  it('shows the component ID for components', async () => {
    const component = { ...baseProduct, role: 'component' as const, parentID: 1 };
    await renderWithProviders(<ProductMetaData product={component} />);
    expect(screen.getByText(COMPONENT_ID_PATTERN)).toBeOnTheScreen();
  });

  it('shows creation date when createdAt is present', async () => {
    const product = { ...baseProduct, createdAt: '2024-01-15T00:00:00Z' };
    await renderWithProviders(<ProductMetaData product={product} />);
    expect(screen.getByText(CREATED_PATTERN)).toBeOnTheScreen();
  });

  it('shows updated date when updatedAt is present', async () => {
    const product = { ...baseProduct, updatedAt: '2024-06-01T00:00:00Z' };
    await renderWithProviders(<ProductMetaData product={product} />);
    expect(screen.getByText(LAST_UPDATED_PATTERN)).toBeOnTheScreen();
  });

  it('does not show creation date when createdAt is absent', async () => {
    await renderWithProviders(<ProductMetaData product={baseProduct} />);
    expect(screen.queryByText(CREATED_PATTERN)).toBeNull();
  });

  it('does not show updated date when updatedAt is absent', async () => {
    await renderWithProviders(<ProductMetaData product={baseProduct} />);
    expect(screen.queryByText(LAST_UPDATED_PATTERN)).toBeNull();
  });

  it('shows Anonymous when ownerUsername is null', async () => {
    const product = { ...baseProduct, ownerUsername: undefined };
    await renderWithProviders(<ProductMetaData product={product} />);
    expect(screen.getByText(OWNER_PATTERN)).toBeOnTheScreen();
    expect(screen.getByText(ANONYMOUS_PATTERN)).toBeOnTheScreen();
  });

  it('shows username and link when ownerUsername is present', async () => {
    const product = { ...baseProduct, ownerUsername: 'testuser' };
    await renderWithProviders(<ProductMetaData product={product} />);
    expect(screen.getByText(OWNER_PATTERN)).toBeOnTheScreen();
    expect(screen.getByText(TESTUSER_PATTERN)).toBeOnTheScreen();
    const link = screen.getByRole('link', { name: "View testuser's profile" });
    expect(link).toHaveStyle({ minHeight: 44, minWidth: 44 });
  });

  describe('edit history', () => {
    const user = setupUser();
    const revision = (over: Record<string, unknown>) => ({
      id: 1,
      version: 2,
      created_at: '2026-11-19T10:00:00Z',
      changed_fields: ['name'],
      snapshot: {},
      by_moderator: false,
      editor_username: null,
      ...over,
    });

    it('lists edits with their editor and changed fields from the "Last updated" date', async () => {
      server.use(
        http.get(`${API_URL}/products/42/revisions`, () =>
          HttpResponse.json({
            items: [
              revision({
                id: 2,
                changed_fields: ['weight_g', 'brand'],
                editor_username: 'testuser',
              }),
              revision({ id: 1, by_moderator: true }),
            ],
            total: 2,
            page: 1,
            size: 50,
            pages: 1,
          }),
        ),
      );
      const product = { ...baseProduct, updatedAt: '2026-11-19T10:00:00Z' };
      await renderWithProviders(<ProductMetaData product={product} />);

      const date = new Date(product.updatedAt).toLocaleDateString();
      // The accessible name starts with the visible date, so voice control finds it (WCAG 2.5.3).
      expect(
        screen.getByRole('button', { name: `Last updated ${date}. Show edit history` }),
      ).toBeOnTheScreen();
      await user.press(screen.getByRole('button', { name: SHOW_HISTORY_PATTERN }));

      expect(await screen.findByText('Changed weight, brand')).toBeOnTheScreen();
      expect(screen.getByText(TESTUSER_PATTERN)).toBeOnTheScreen();
      expect(screen.getByText(MODERATOR_PATTERN)).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: HIDE_HISTORY_PATTERN })).toBeOnTheScreen();
    });

    it("reads a component's history from the component route", async () => {
      server.use(
        http.get(`${API_URL}/components/42/revisions`, () =>
          HttpResponse.json({ items: [], total: 0, page: 1, size: 50, pages: 0 }),
        ),
      );
      const component = {
        ...baseProduct,
        role: 'component' as const,
        parentID: 1,
        updatedAt: '2026-11-19T10:00:00Z',
      };
      await renderWithProviders(<ProductMetaData product={component} />);

      await user.press(screen.getByRole('button', { name: SHOW_HISTORY_PATTERN }));

      expect(await screen.findByText(NO_EDITS_PATTERN)).toBeOnTheScreen();
    });
  });
});
