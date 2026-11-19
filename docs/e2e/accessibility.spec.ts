import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

// Aligned across www/docs/app: WCAG 2.0-2.2, level A + AA, the stated target.
// target-size (2.5.8) is the only 2.2-only rule axe-core ships; 2.4.11 and
// 2.4.13 have no axe coverage and are verified by hand.
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];

// Mermaid renders after `load`. Until every source block is an SVG, axe would scan
// the diagram source text instead of the diagrams readers get.
const UNRENDERED_DIAGRAMS =
  '.expressive-code pre[data-language="mermaid"], .r9lab-mermaid:not(:has(svg))';

async function analyzePage(page: Page, options: { exclude?: string[] } = {}) {
  await expect(page.locator(UNRENDERED_DIAGRAMS)).toHaveCount(0, { timeout: 15_000 });

  // Neutralize animations so results are deterministic (mirrors www).
  await page.addStyleTag({
    content: `
      *,
      *::before,
      *::after {
        animation: none !important;
        transition: none !important;
      }
    `,
  });

  // Full page (header/nav/footer included), not just <main>; the repo-authored
  // chrome is fair game for a11y bugs too.
  let builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  for (const selector of options.exclude ?? []) {
    builder = builder.exclude(selector);
  }
  const results = await builder.analyze();
  // Starlight's search button is named "Search" and also shows its "Ctrl K" shortcut.
  // axe 4.14 counts the shortcut as label text; the name still holds the label, so
  // 2.5.3 is met. Starlight won't change it (withastro/starlight#4260).
  results.violations = results.violations.flatMap((violation) => {
    if (violation.id !== 'label-content-name-mismatch') return [violation];
    const nodes = violation.nodes.filter(
      (node) => !node.html.startsWith('<button data-open-modal=""'),
    );
    return nodes.length > 0 ? [{ ...violation, nodes }] : [];
  });
  return results;
}

async function switchToDarkTheme(page: Page) {
  const themeSelect = page.locator('starlight-theme-select select').first();
  await themeSelect.selectOption('dark');
  await expect.poll(async () => page.locator('html').getAttribute('data-theme')).toBe('dark');
}

test.describe('Accessibility', () => {
  test('homepage has no accessibility violations in dark theme', async ({ page }) => {
    await page.goto('/');
    await switchToDarkTheme(page);
    const results = await analyzePage(page);
    expect(results.violations).toEqual([]);
  });
});

// Every built page, so a new page or a new component cannot ship a violation
// unnoticed. The list comes from dist/, which the test recipe builds first;
// redirect stubs are skipped. #api-reference is filled client-side by the
// third-party Scalar bundle; its markup isn't ours to fix, so only the
// repo-authored switcher nav and noscript fallback around it are scanned.
const DIST = join(import.meta.dirname, '..', 'dist');

function builtPages(dir = DIST): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return builtPages(path);
    if (!entry.name.endsWith('.html')) return [];
    if (readFileSync(path, 'utf8').includes('http-equiv="refresh"')) return [];
    return [path];
  });
}

function routeOf(file: string): string {
  const route = `/${file.slice(DIST.length + 1).replace(/(^|\/)index\.html$/, '')}`;
  // The 404 page is only served for an address that does not exist.
  return route === '/404.html' ? '/no-such-page/' : route;
}

const PAGES = builtPages().map(routeOf);
// An empty or half-built dist/ would otherwise generate no tests and pass.
if (PAGES.length < 20)
  throw new Error(`dist/ has only ${PAGES.length} pages; build the site first`);

// Wide tables and code blocks only overflow, and so only fail the scrollable-region
// rule, on a phone: scan at both widths.
for (const width of [1280, 375]) {
  test.describe(`Accessibility, every page at ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } });

    for (const route of PAGES) {
      test(`${route} has no accessibility violations`, async ({ page }) => {
        await page.goto(route);
        const results = await analyzePage(page, { exclude: ['#api-reference'] });
        expect(results.violations).toEqual([]);
      });
    }
  });
}

// WCAG 4.1.3: Pagefind writes the result count into a plain paragraph, so a screen
// reader hears nothing after typing. src/scripts/search-status.ts mirrors it into a
// status region that exists before the search runs.
test('search announces its result count in a status region', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Control+k');
  await page.locator('dialog[open] input').fill('camera');
  await expect(page.locator('dialog[open]').getByRole('status')).toHaveText(/results? for camera/, {
    timeout: 10_000,
  });
});

test.describe('Viewport overflow', () => {
  const VIEWPORT_WIDTH = 375;
  const TOLERANCE_PX = 1;

  test.use({ viewport: { width: VIEWPORT_WIDTH, height: 800 } });

  // system-design carries the widest terminal block on the site (a directory
  // tree), which is what made long code lines escape their own `pre` and push
  // the whole page sideways. Keep it in this list as the regression guard.
  for (const path of ['/architecture/datamodel/', '/architecture/system-design/', '/api/public/']) {
    test(`${path} has no horizontal overflow at ${VIEWPORT_WIDTH}px`, async ({ page }) => {
      await page.goto(path);
      // biome-ignore lint/suspicious/noPlaywrightNetworkidle: the overflow check must run after fonts and diagrams have loaded.
      await page.waitForLoadState('networkidle');
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth).toBeLessThanOrEqual(VIEWPORT_WIDTH + TOLERANCE_PX);
    });
  }
});
