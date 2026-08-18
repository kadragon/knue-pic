/**
 * The two states the page can be in before any feature view has data: loading, and failed to load.
 *
 * Strings live here rather than inline so the banned-phrase test (`docs/conventions.md` →
 * Framing Vocabulary) has a single module to assert over. None of them may frame the data as a
 * recommendation or as expense tracking.
 */

export const LOADING_MESSAGE = '데이터를 불러오는 중입니다.';

/**
 * Deliberately says nothing about the underlying error. The failure the user will actually hit is
 * the published file not being there yet, and an HTTP status or a stack trace tells them nothing
 * they can act on (`docs/eval-criteria.md` → Graceful Degradation: a failure path must not show a
 * raw error).
 */
export const LOAD_ERROR_MESSAGE = '데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';

export const RETRY_LABEL = '다시 시도';

/**
 * One live region, reused across states.
 *
 * A `role="status"` element only announces content that changes *while it is already in the
 * accessibility tree*. Creating a fresh region that already holds its text — the obvious way to
 * write this — announces nothing at all, so a screen-reader user whose load fails hears silence.
 * The region is therefore created once and only its `textContent` is swapped afterwards.
 */
function ensureRegion(content: HTMLElement): HTMLElement {
  const existing = content.querySelector<HTMLElement>('.data-state');
  if (existing) return existing;

  const region = document.createElement('p');
  region.className = 'data-state';
  region.setAttribute('role', 'status');
  content.replaceChildren(region);
  return region;
}

export function renderLoading(content: HTMLElement): void {
  ensureRegion(content).textContent = LOADING_MESSAGE;
  content.querySelector('.data-state-retry')?.remove();
}

/**
 * A native `<button>`, so the retry control is focusable and keyboard-operable with no ARIA.
 * Returns it so the caller can restore focus after a retry that failed again — re-rendering
 * silently drops the user back to the top of the document otherwise.
 */
export function renderLoadFailure(content: HTMLElement, onRetry: () => void): HTMLButtonElement {
  ensureRegion(content).textContent = LOAD_ERROR_MESSAGE;

  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'data-state-retry';
  retry.textContent = RETRY_LABEL;
  retry.addEventListener('click', onRetry);

  content.querySelector('.data-state-retry')?.remove();
  content.append(retry);
  return retry;
}
