import { expect, test } from '@playwright/test';
import { expectCanonicalUrl, expectContentPage } from './helpers.ts';

const ACCESSIBILITY_TITLE = /Accessibility/;
const STATUS_TERMS = /not assessed|partially conformant|non-conformant/i;
const FULLY_CONFORMANT = /fully conformant/i;
const LAST_REVIEWED = /Last reviewed:\s*(\d{1,2} \w+ \d{4})/;
// 12 months plus a month's grace: past this the yearly review has been missed.
const MAX_REVIEW_AGE_DAYS = 400;
const MS_PER_DAY = 86_400_000;

test('accessibility statement renders', async ({ page }) => {
  await page.goto('/accessibility');
  await expect(page).toHaveTitle(ACCESSIBILITY_TITLE);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Accessibility statement');
  await expect(page.getByRole('heading', { level: 2 })).toHaveText([
    'Using R9lab',
    'How accessible R9lab is',
    'Known problems',
    'Tell us about a problem',
    'How we check',
    'Tested with',
    'About this statement',
  ]);
  await expectContentPage(page);
  // The statement's whole point is that it does not overclaim.
  const body = page.locator('.content-page');
  await expect(body.getByText(STATUS_TERMS).first()).toBeVisible();
  await expect(body.getByText(FULLY_CONFORMANT)).toHaveCount(0);
  // The statement's address is written in the Markdown; the footer's comes from site
  // config. They must match, or the statement points readers to a stale inbox.
  const footerMailto = await page
    .locator('footer')
    .getByRole('link', { name: /@/ })
    .getAttribute('href');
  expect(footerMailto).toMatch(/^mailto:.+@.+/);
  await expect(body.getByRole('link', { name: /@/ })).toHaveAttribute('href', footerMailto ?? '');
  await expectCanonicalUrl(page, '/accessibility/');
});

test('accessibility statement was reviewed within the last 400 days', async ({ page }) => {
  await page.goto('/accessibility');
  const text = await page.locator('.content-page').innerText();
  const match = LAST_REVIEWED.exec(text);
  expect(match, 'a "Last reviewed: <date>" line').not.toBeNull();
  const reviewed = new Date(`${match?.[1]} UTC`);
  expect(Number.isNaN(reviewed.getTime())).toBe(false);
  expect((Date.now() - reviewed.getTime()) / MS_PER_DAY).toBeLessThan(MAX_REVIEW_AGE_DAYS);
});

test('the footer of every page links to the statement', async ({ page }) => {
  for (const path of ['/', '/privacy', '/terms', '/accessibility']) {
    // biome-ignore lint/performance/noAwaitInLoops: one page, so each route loads after the last.
    await page.goto(path);
    await expect(
      page.locator('footer').getByRole('link', { name: /accessibility/i }),
    ).toHaveAttribute('href', '/accessibility');
  }
});
