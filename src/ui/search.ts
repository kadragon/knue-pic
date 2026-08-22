import type { PlaceRecord, PlacesDataset } from '../data/types';
import { ALL_CATEGORIES, filterPlaces, listCategories } from '../stats/search';

/**
 * Search and category filter over the whole dataset, with the results list underneath.
 *
 * The controls are built once and never rebuilt: only the results container is replaced as the
 * query changes. Re-rendering the text input on every keystroke would move the caret to the end
 * and drop focus — the same failure `place-columns.ts` avoids by flipping `aria-pressed` in
 * place rather than re-rendering its buttons.
 *
 * Filtering itself lives in `src/stats/search.ts`; this module only reads the controls and paints
 * what comes back.
 */

export const SEARCH_HEADING = '장소 찾기';

export const SEARCH_INPUT_LABEL = '이름 · 주소 검색';

export const SEARCH_INPUT_PLACEHOLDER = '이름이나 주소를 입력하세요';

export const CATEGORY_LABEL = '분류';

/** The `<option>` that clears the category filter — not a category name the collector can emit. */
export const ALL_CATEGORIES_OPTION = '전체';

export const NO_RESULTS_MESSAGE = '조건에 맞는 곳이 없습니다.';

/**
 * The empty-query state.
 *
 * It used to list all 435 published places alphabetically, which answered no question the visitor
 * had: dataset order carries no signal, and the wall of rows pushed every section below it off the
 * end of the page. Browsing by usage is what the ranked list above is for; this control is for
 * looking something up, so with nothing entered it says what it can do instead of dumping the file.
 */
export function searchPromptLabel(total: number): string {
  return `${total}곳 중에서 이름이나 주소로 찾거나, 분류를 선택하세요.`;
}

export const RESET_LABEL = '검색 조건 초기화';

export function resultCountLabel(count: number): string {
  return `${count}곳`;
}

export function placeSummary(place: PlaceRecord): string {
  return [place.category, place.address].join(' · ');
}

export function renderPlaceSearch(
  container: HTMLElement,
  dataset: PlacesDataset,
  onSelect: (placeId: string) => void,
): void {
  const section = document.createElement('section');
  section.className = 'place-search';

  const heading = document.createElement('h2');
  heading.textContent = SEARCH_HEADING;

  const controls = document.createElement('div');
  controls.className = 'place-search-controls';

  const textField = document.createElement('label');
  textField.className = 'place-search-field';
  const textLabel = document.createElement('span');
  textLabel.textContent = SEARCH_INPUT_LABEL;
  const input = document.createElement('input');
  input.type = 'search';
  input.className = 'place-search-input';
  input.placeholder = SEARCH_INPUT_PLACEHOLDER;
  textField.append(textLabel, input);

  const categoryField = document.createElement('label');
  categoryField.className = 'place-search-field';
  const categoryLabel = document.createElement('span');
  categoryLabel.textContent = CATEGORY_LABEL;
  const select = document.createElement('select');
  select.className = 'place-search-category';

  // The empty value stands for "no filter" so it can never be mistaken for a category named 전체.
  const allOption = document.createElement('option');
  allOption.value = '';
  allOption.textContent = ALL_CATEGORIES_OPTION;
  select.append(allOption);
  for (const category of listCategories(dataset)) {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    select.append(option);
  }
  categoryField.append(categoryLabel, select);

  controls.append(textField, categoryField);

  /**
   * Created once and only its text rewritten, the same arrangement `src/ui/data-state.ts` documents:
   * a live region that is replaced on every keystroke announces nothing at all, so a screen-reader
   * user typing a query would never hear how many places matched.
   */
  const count = document.createElement('p');
  count.className = 'place-search-count';
  count.setAttribute('aria-live', 'polite');
  count.setAttribute('aria-atomic', 'true');

  const results = document.createElement('div');
  results.className = 'place-search-results';

  /**
   * Focus lands on the text input rather than staying on the removed reset button: the button is
   * gone the moment the query clears, and leaving focus on a detached node drops the user back to
   * the top of the document.
   */
  function reset(): void {
    input.value = '';
    select.value = '';
    update();
    input.focus();
  }

  function update(): void {
    // Neither control touched: nothing to search for yet, so nothing is listed.
    if (input.value.trim() === '' && select.value === '') {
      count.textContent = searchPromptLabel(dataset.places.length);
      results.replaceChildren();
      return;
    }

    const category = select.value === '' ? ALL_CATEGORIES : select.value;
    const found = filterPlaces(dataset, { text: input.value, category });
    count.textContent = resultCountLabel(found.length);

    if (found.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'place-search-empty';
      empty.textContent = NO_RESULTS_MESSAGE;

      const resetButton = document.createElement('button');
      resetButton.type = 'button';
      resetButton.className = 'place-search-reset';
      resetButton.textContent = RESET_LABEL;
      resetButton.addEventListener('click', reset);

      results.replaceChildren(empty, resetButton);
      return;
    }

    const list = document.createElement('ul');
    list.className = 'place-search-list';
    for (const place of found) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'place-select';
      button.dataset['placeId'] = place.id;
      button.addEventListener('click', () => {
        onSelect(place.id);
      });

      const name = document.createElement('span');
      name.className = 'place-select-name';
      name.textContent = place.name;
      const meta = document.createElement('span');
      meta.className = 'place-select-meta';
      meta.textContent = placeSummary(place);

      button.append(name, meta);
      item.append(button);
      list.append(item);
    }

    results.replaceChildren(list);
  }

  input.addEventListener('input', update);
  select.addEventListener('change', update);

  update();
  section.append(heading, controls, count, results);
  container.replaceChildren(section);
}
