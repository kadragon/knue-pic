import { describe, expect, it, vi } from 'vitest';
import { PLACE_KINDS } from '../data/types';
import {
  ALL_KINDS_LABEL,
  KIND_FILTER_LABEL,
  KIND_LABELS,
  KIND_OPTIONS,
  markActiveKind,
  renderKindFilter,
} from './kind-filter';

function options(root: HTMLElement): HTMLButtonElement[] {
  return [...root.querySelectorAll<HTMLButtonElement>('.kind-filter-option')];
}

function pressed(root: HTMLElement): HTMLButtonElement | undefined {
  return options(root).find((button) => button.getAttribute('aria-pressed') === 'true');
}

describe('renderKindFilter', () => {
  it('offers 전체 plus every published kind, labelled in Korean', () => {
    const root = document.createElement('div');

    renderKindFilter(root, null, () => {});

    expect(options(root).map((button) => button.textContent)).toEqual([
      ALL_KINDS_LABEL,
      ...PLACE_KINDS.map((kind) => KIND_LABELS[kind]),
    ]);
  });

  it('groups the buttons under a label so the control is announced as one thing', () => {
    const root = document.createElement('div');

    renderKindFilter(root, null, () => {});

    const group = root.querySelector('.kind-filter');
    expect(group?.getAttribute('role')).toBe('group');
    expect(group?.getAttribute('aria-label')).toBe(KIND_FILTER_LABEL);
  });

  it('reports the selection the reader pressed', () => {
    const root = document.createElement('div');
    const onSelect = vi.fn();

    renderKindFilter(root, null, onSelect);
    options(root)
      .find((button) => button.textContent === KIND_LABELS.cafe)
      ?.click();

    expect(onSelect).toHaveBeenCalledWith('cafe');
  });

  it('reports null for 전체, which is not one of the kinds', () => {
    const root = document.createElement('div');
    const onSelect = vi.fn();

    renderKindFilter(root, 'cafe', onSelect);
    options(root)
      .find((button) => button.textContent === ALL_KINDS_LABEL)
      ?.click();

    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('marks exactly the active option, whichever it is', () => {
    for (const kind of KIND_OPTIONS) {
      const root = document.createElement('div');
      renderKindFilter(root, kind, () => {});

      expect(options(root).filter((b) => b.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
      expect(pressed(root)?.dataset['kind']).toBe(kind ?? '');
    }
  });

  it('keeps the pressed button alive when the selection moves', () => {
    const root = document.createElement('div');
    renderKindFilter(root, null, () => {});
    const cafe = options(root).find((button) => button.dataset['kind'] === 'cafe');

    markActiveKind(root, 'cafe');

    // The same node, not a replacement: a rebuilt button would take the reader's focus with it.
    expect(pressed(root)).toBe(cafe);
  });
});
