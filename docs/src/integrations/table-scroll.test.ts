import { markdownToHtml } from 'satteri';
import { describe, expect, it } from 'vitest';
import { tableScroll } from './table-scroll.ts';

const TABLE = '| a | b |\n| - | - |\n| 1 | 2 |\n';
const render = (md: string) => markdownToHtml(md, { hastPlugins: [tableScroll] }).html;

describe('tableScroll', () => {
  it('wraps each table in a focusable region named after the heading above, numbering repeats', () => {
    const html = render(`## Columns\n\n${TABLE}\n${TABLE}\n## Other\n\n${TABLE}`);
    expect(html.match(/<div class="table-scroll"/g)).toHaveLength(3);
    expect(html).toContain('aria-label="Table: Columns"');
    expect(html).toContain('aria-label="Table: Columns (2)"');
    expect(html).toContain('aria-label="Table: Other"');
    expect(html).toMatch(/<div class="table-scroll"[^>]*tabindex="0"[^>]*role="region"/i);
  });

  it('names a table plainly when no heading precedes it, and starts fresh per document', () => {
    expect(render(TABLE)).toContain('aria-label="Table"');
    expect(render(TABLE)).toContain('aria-label="Table"');
    expect(render(TABLE)).not.toContain('(2)');
  });
});
