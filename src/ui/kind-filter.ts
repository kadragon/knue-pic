import { PLACE_KINDS, type PlaceKind } from '../data/types';

/**
 * The page-wide 업종 control: it narrows the four discovery columns and the search results at once.
 *
 * It sits above both rather than inside either because it answers a question about the whole page —
 * "show me only the cafés" — and a control that narrowed one list while the other kept listing
 * everything would read as a bug in the list it did not touch.
 *
 * The button group is the same shape as `place-list.ts`'s period selector, and for the same reason:
 * the pressed state is flipped in place. Re-rendering the group would replace the button the reader
 * just activated and drop keyboard focus to the top of the document.
 */

export const KIND_FILTER_LABEL = '업종 선택';

/** Visible heading for the group. The group is already named by `KIND_FILTER_LABEL`, so this span
 * is hidden from assistive tech rather than announced a second time. */
export const KIND_FILTER_HEADING = '업종';

/** `null` is "no filter" — `ALL_KINDS` in `src/stats/search.ts`, not a member of `PLACE_KINDS`. */
export type KindSelection = PlaceKind | null;

export const ALL_KINDS_LABEL = '전체';

/**
 * Korean labels for the English slugs the dataset carries (`collector/kinds.py` decides which
 * place gets which). Describes what kind of business it is and nothing about how good it is —
 * `docs/conventions.md` → Framing Vocabulary.
 */
export const KIND_LABELS: Record<PlaceKind, string> = {
  restaurant: '식당',
  cafe: '카페·디저트',
  lunchbox: '도시락',
  other: '기타',
};

/** 전체 first, then the dataset's own order, so the widest option is where the eye starts. */
export const KIND_OPTIONS: KindSelection[] = [null, ...PLACE_KINDS];

export function kindOptionLabel(kind: KindSelection): string {
  return kind === null ? ALL_KINDS_LABEL : KIND_LABELS[kind];
}

/** The `data-kind` value that stands for "no filter" — the empty string is not a slug. */
const ALL_KINDS_VALUE = '';

function kindValue(kind: KindSelection): string {
  return kind ?? ALL_KINDS_VALUE;
}

/**
 * Flips `aria-pressed` without rebuilding the buttons, so the pressed one keeps focus.
 *
 * Exported because the selection is owned by `bootstrap.ts`: it is what the columns and the search
 * are rendered from, so the control cannot be the only thing that knows it.
 */
export function markActiveKind(container: HTMLElement, active: KindSelection): void {
  for (const button of container.querySelectorAll<HTMLButtonElement>('.kind-filter-option')) {
    button.setAttribute('aria-pressed', String(button.dataset['kind'] === kindValue(active)));
  }
}

export function renderKindFilter(
  container: HTMLElement,
  active: KindSelection,
  onSelect: (kind: KindSelection) => void,
): void {
  const group = document.createElement('div');
  group.className = 'kind-filter';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', KIND_FILTER_LABEL);

  const label = document.createElement('span');
  label.className = 'kind-filter-label';
  label.textContent = KIND_FILTER_HEADING;
  label.setAttribute('aria-hidden', 'true');
  group.append(label);

  for (const kind of KIND_OPTIONS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'kind-filter-option';
    button.dataset['kind'] = kindValue(kind);
    button.textContent = kindOptionLabel(kind);
    button.setAttribute('aria-pressed', String(kind === active));
    button.addEventListener('click', () => {
      onSelect(kind);
    });
    group.append(button);
  }

  container.replaceChildren(group);
}
