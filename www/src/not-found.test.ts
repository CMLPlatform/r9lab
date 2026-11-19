import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';

import { getPublicSiteConfig } from '@/config/public.ts';

import NotFound from './pages/404.astro';

describe('404 page', () => {
  it('opens every link into the app in the same tab', async () => {
    const html = await (await AstroContainer.create()).renderToString(NotFound);
    const appUrl = getPublicSiteConfig().appUrl.replace(/\/$/, '');
    const appLinks = [...html.matchAll(/<a\b[^>]*>/g)]
      .map(([tag]) => tag)
      .filter((tag) => tag.includes(`href="${appUrl}`));

    // DESIGN.md, The New-Tab Rule: the app is the same product.
    expect(appLinks.length).toBeGreaterThan(0);
    for (const tag of appLinks) {
      expect(tag).not.toMatch(/\btarget=/);
    }
  });
});
