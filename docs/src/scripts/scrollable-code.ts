// A code block that overflows scrolls sideways, and a keyboard user can only reach
// the clipped part if the block takes focus (WCAG 2.1.1). The blocks are rendered
// after the markdown plugins run, so the tab stop is set here, only where it
// is needed, and follows the viewport width.
const blocks = [...document.querySelectorAll<HTMLElement>('.expressive-code pre')];

function update() {
  for (const pre of blocks) {
    if (pre.scrollWidth > pre.clientWidth) {
      pre.tabIndex = 0;
    } else {
      pre.removeAttribute('tabindex');
    }
  }
}

update();
new ResizeObserver(update).observe(document.documentElement);
