/*
 * Pagefind's search UI writes "N results for <term>" into a paragraph it recreates on
 * every search, so screen readers announce nothing (WCAG 4.1.3). A status region only
 * speaks when its text changes after it is already in the page, so this one is added
 * once, next to the results, and given a copy of Pagefind's message whenever it changes.
 */
function mirrorSearchMessage(dialog: HTMLDialogElement) {
  const status = document.createElement('div');
  status.setAttribute('role', 'status');
  status.className = 'sr-only';
  dialog.append(status);
  new MutationObserver(() => {
    const message = dialog.querySelector('.pagefind-ui__message')?.textContent?.trim() ?? '';
    if (status.textContent !== message) {
      status.textContent = message;
    }
  }).observe(dialog, { childList: true, subtree: true, characterData: true });
}

const searchDialog = document.querySelector<HTMLDialogElement>('site-search dialog');
if (searchDialog) {
  mirrorSearchMessage(searchDialog);
}
