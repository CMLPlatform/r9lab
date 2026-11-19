import { defineHastPlugin } from 'satteri';

const HEADING = /^h[1-6]$/;

/**
 * Makes wide tables keyboard-scrollable (WCAG 2.1.1). Each markdown table goes in a
 * focusable, named scroll region, so a keyboard user can reach columns clipped on a
 * phone. The name comes from the nearest heading above; repeats get a number so no
 * two regions share a name. A
 * factory, so the heading and the counts start fresh for each document.
 */
export const tableScroll = () => {
  let heading = '';
  const used = new Map<string, number>();

  return defineHastPlugin({
    name: 'table-scroll',
    element: {
      filter: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table'],
      visit(node, ctx) {
        if (HEADING.test(node.tagName)) {
          heading = ctx.textContent(node).trim();
          return;
        }
        const base = heading ? `Table: ${heading}` : 'Table';
        const count = (used.get(base) ?? 0) + 1;
        used.set(base, count);
        ctx.wrapNode(node, {
          type: 'element',
          tagName: 'div',
          properties: {
            className: ['table-scroll'],
            tabIndex: 0,
            role: 'region',
            ariaLabel: count > 1 ? `${base} (${count})` : base,
          },
          children: [],
        });
      },
    },
  });
};
