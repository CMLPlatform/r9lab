import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import Layout from './Layout.astro';

describe('Layout', () => {
  it('puts a skip link first, pointing at the main landmark', async () => {
    const html = await (await AstroContainer.create()).renderToString(Layout, {
      props: { title: 'Test' },
      slots: { default: '<p>body</p>' },
    });
    expect(html).toContain('<main id="main"');
    const skip = html.indexOf('href="#main"');
    const header = html.indexOf('<header');
    expect(skip).toBeGreaterThan(-1);
    expect(header).toBeGreaterThan(-1);
    expect(skip).toBeLessThan(header);
  });
});
