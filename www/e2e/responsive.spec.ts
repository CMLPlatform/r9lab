import { expect, test } from '@playwright/test';

import { expectHomepageHero } from './helpers.ts';

test.describe('Responsive layout', () => {
  test('landing page is usable on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 }); // iPhone 14 Pro
    await page.goto('/');
    await expectHomepageHero(page);
  });

  test('landing page is usable on tablet viewport', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 }); // iPad
    await page.goto('/');
    await expectHomepageHero(page);
  });

  test('privacy page is readable on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/privacy');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  // WCAG 1.4.10: at 320 CSS px (1280 px at 400% zoom) no page may scroll sideways.
  for (const path of ['/', '/privacy', '/terms', '/accessibility', '/accessibility-assessment']) {
    test(`${path} does not scroll sideways at 320 px`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 800 });
      await page.goto(path);
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth).toBeLessThanOrEqual(320);
    });
  }
});
