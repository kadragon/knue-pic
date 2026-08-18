import type { Period } from '../data/types';

/**
 * The 1m / 6m / 1y switch. Every statistic on the page is re-derived from `transactions` when this
 * changes (`docs/architecture.md` → Period recomputation), so the selector owns no numbers itself —
 * it reports the chosen period and nothing more.
 *
 * Strings live here rather than inline so the banned-phrase test has a single module to assert
 * over, the same arrangement as `src/ui/data-state.ts`.
 */

export const PERIOD_GROUP_LABEL = '기간 선택';

export const PERIOD_LABELS: Record<Period, string> = {
  '1m': '최근 1개월',
  '6m': '최근 6개월',
  '1y': '최근 1년',
};

/** Rendered in this order; `1y` is the default because it is the only fully retained window. */
export const PERIOD_ORDER: Period[] = ['1m', '6m', '1y'];

/**
 * Native `<button>`s in a labelled group: focusable and keyboard-operable with no ARIA beyond
 * `aria-pressed`, which is what tells a screen reader which period is currently showing. Colour
 * alone never marks the active button (`docs/conventions.md` → Accessibility).
 */
export function renderPeriodSelector(
  container: HTMLElement,
  selected: Period,
  onSelect: (period: Period) => void,
): void {
  const group = document.createElement('div');
  group.className = 'period-selector';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', PERIOD_GROUP_LABEL);

  for (const period of PERIOD_ORDER) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'period-option';
    button.dataset['period'] = period;
    button.textContent = PERIOD_LABELS[period];
    button.setAttribute('aria-pressed', String(period === selected));
    button.addEventListener('click', () => {
      onSelect(period);
    });
    group.append(button);
  }

  container.replaceChildren(group);
}

/**
 * Flips `aria-pressed` in place instead of re-rendering the group.
 *
 * Re-rendering would replace the button the user just activated and drop keyboard focus to the top
 * of the document — the same failure `renderLoadFailure` guards against for the retry control.
 */
export function markSelectedPeriod(container: HTMLElement, selected: Period): void {
  for (const button of container.querySelectorAll<HTMLButtonElement>('.period-option')) {
    button.setAttribute('aria-pressed', String(button.dataset['period'] === selected));
  }
}
