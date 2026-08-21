import { describe, expect, it, vi } from 'vitest';
import { SAMPLE_DATASET } from '../data/fixtures/sample-dataset';
import {
  ALL_CATEGORIES_OPTION,
  NO_RESULTS_MESSAGE,
  RESET_LABEL,
  renderPlaceSearch,
  resultCountLabel,
  searchPromptLabel,
} from './search';

function searchInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('.place-search-input');
  if (!input) throw new Error('search input is missing');
  return input;
}

function categorySelect(container: HTMLElement): HTMLSelectElement {
  const select = container.querySelector<HTMLSelectElement>('.place-search-category');
  if (!select) throw new Error('category select is missing');
  return select;
}

function type(container: HTMLElement, text: string): void {
  const input = searchInput(container);
  input.value = text;
  input.dispatchEvent(new Event('input'));
}

describe('renderPlaceSearch', () => {
  it('lists nothing until a query or a category is entered', () => {
    const container = document.createElement('div');

    renderPlaceSearch(container, SAMPLE_DATASET, vi.fn());

    // Dumping the whole file answers no question and buries every section below it; the prompt
    // names the size of the set instead.
    expect(container.querySelectorAll('.place-search-list li')).toHaveLength(0);
    expect(container.textContent).toContain(searchPromptLabel(SAMPLE_DATASET.places.length));
  });

  it('lists a category on its own, with no text typed', () => {
    const container = document.createElement('div');

    renderPlaceSearch(container, SAMPLE_DATASET, vi.fn());
    const select = categorySelect(container);
    select.value = '한식';
    select.dispatchEvent(new Event('change'));

    const listed = container.querySelectorAll('.place-search-list li');
    expect(listed.length).toBeGreaterThan(0);
    expect(container.textContent).toContain(resultCountLabel(listed.length));
  });

  it('announces the result count from one live region rather than a replaced node', () => {
    const container = document.createElement('div');

    renderPlaceSearch(container, SAMPLE_DATASET, vi.fn());
    const region = container.querySelector('.place-search-count');
    expect(region?.getAttribute('aria-live')).toBe('polite');

    type(container, '칼국수');

    // Same node, new text — a replaced region never announces.
    expect(container.querySelector('.place-search-count')).toBe(region);
    expect(region?.textContent).toBe(resultCountLabel(1));
  });

  it('offers every dataset category plus an all-categories option', () => {
    const container = document.createElement('div');

    renderPlaceSearch(container, SAMPLE_DATASET, vi.fn());
    const options = [...categorySelect(container).options].map((option) => option.textContent);

    expect(options[0]).toBe(ALL_CATEGORIES_OPTION);
    expect(options).toEqual([ALL_CATEGORIES_OPTION, '기타', '분식', '중식', '카페', '한식']);
  });

  it('narrows the list as the query is typed', () => {
    const container = document.createElement('div');

    renderPlaceSearch(container, SAMPLE_DATASET, vi.fn());
    type(container, '칼국수');

    expect(container.querySelectorAll('.place-search-list li')).toHaveLength(1);
    expect(container.textContent).toContain('새터말칼국수');
  });

  it('applies the category filter together with the text', () => {
    const container = document.createElement('div');

    renderPlaceSearch(container, SAMPLE_DATASET, vi.fn());
    const select = categorySelect(container);
    select.value = '한식';
    select.dispatchEvent(new Event('change'));
    type(container, '태성탑연로');

    expect(container.querySelectorAll('.place-search-list li')).toHaveLength(1);
    expect(container.textContent).toContain('한밭식당');
  });

  it('offers a reset control when nothing matches, and clears back to the prompt', () => {
    const container = document.createElement('div');
    document.body.append(container);

    renderPlaceSearch(container, SAMPLE_DATASET, vi.fn());
    const select = categorySelect(container);
    select.value = '카페';
    select.dispatchEvent(new Event('change'));
    type(container, 'zzz');

    expect(container.textContent).toContain(NO_RESULTS_MESSAGE);
    const reset = container.querySelector<HTMLButtonElement>('.place-search-reset');
    expect(reset?.textContent).toBe(RESET_LABEL);

    reset?.click();

    expect(searchInput(container).value).toBe('');
    expect(categorySelect(container).value).toBe('');
    // Back to the empty-query state, not to a list of everything.
    expect(container.querySelectorAll('.place-search-list li')).toHaveLength(0);
    expect(container.textContent).toContain(searchPromptLabel(SAMPLE_DATASET.places.length));
    // The reset button is gone; focus must not be left on a detached node.
    expect(document.activeElement).toBe(searchInput(container));

    container.remove();
  });

  it('keeps the same input element across queries so the caret is not lost', () => {
    const container = document.createElement('div');

    renderPlaceSearch(container, SAMPLE_DATASET, vi.fn());
    const before = searchInput(container);
    type(container, '카페');

    expect(searchInput(container)).toBe(before);
  });

  it('reports the selected place', () => {
    const container = document.createElement('div');
    const onSelect = vi.fn();

    renderPlaceSearch(container, SAMPLE_DATASET, onSelect);
    type(container, '칼국수');
    container.querySelector<HTMLButtonElement>('.place-search-list .place-select')?.click();

    expect(onSelect).toHaveBeenCalledWith('restaurant_000006');
  });
});
