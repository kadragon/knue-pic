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

export function renderLoading(content: HTMLElement): void {
  const message = document.createElement('p');
  message.className = 'data-state';
  message.textContent = LOADING_MESSAGE;
  // Announced to assistive tech when the state later swaps to the failure message.
  message.setAttribute('role', 'status');

  content.replaceChildren(message);
}

/** A native `<button>`, so the retry control is focusable and keyboard-operable with no ARIA. */
export function renderLoadFailure(content: HTMLElement, onRetry: () => void): void {
  const message = document.createElement('p');
  message.className = 'data-state';
  message.textContent = LOAD_ERROR_MESSAGE;
  message.setAttribute('role', 'status');

  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'data-state-retry';
  retry.textContent = RETRY_LABEL;
  retry.addEventListener('click', onRetry);

  content.replaceChildren(message, retry);
}
