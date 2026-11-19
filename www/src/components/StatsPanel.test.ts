import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';

import StatsPanel from './StatsPanel.astro';

describe('StatsPanel', () => {
  it('renders the hidden stats shell with the data-stat hooks the client script fills', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(StatsPanel);

    expect(html).toContain('id="stats-panel"');
    expect(html).toContain('hidden');
    // A one-off render, not a live update: announcing the whole ledger would be noise.
    expect(html).not.toContain('aria-live');
    for (const hook of [
      'hero',
      'tiles',
      'chart-heading',
      'controls',
      'chart',
      'table',
      'caption',
    ]) {
      expect(html).toContain(`data-stat="${hook}"`);
    }
  });
});
