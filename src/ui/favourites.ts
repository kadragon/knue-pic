import type { PlaceRecord } from '../data/types';
import type { Favourites } from './favourites-store';
import { renderPlaceMapLinks } from './place-detail';

export const FAVOURITES_NOTICE = '즐겨찾기는 이 브라우저에만 저장되며 기기 간에 동기화되지 않습니다. 브라우저 데이터를 삭제하면 즐겨찾기도 사라집니다.';
const READ_FAILURE = '즐겨찾기를 불러오지 못했습니다. 브라우저의 저장소 설정을 확인한 뒤 새로고침해 주세요.';

export function renderFavourites(
  container: HTMLElement,
  places: readonly PlaceRecord[],
  store: Favourites,
  onSelect: (id: string) => void,
): () => void {
  const section = document.createElement('details');
  section.className = 'favourites';
  const summary = document.createElement('summary');
  const notice = document.createElement('p');
  notice.className = 'favourites-notice';
  notice.textContent = FAVOURITES_NOTICE;
  const list = document.createElement('ul');
  list.className = 'favourites-list';
  const empty = document.createElement('p');
  empty.textContent = store.readable ? '저장한 곳이 없습니다. 상세 화면에서 즐겨찾기에 추가해 보세요.' : READ_FAILURE;
  section.append(summary, notice, list, empty);
  container.replaceChildren(section);
  const byId = new Map(places.map((place) => [place.id, place]));
  // Reuse surviving rows so detail dismissal can restore the original button's focus.
  const rows = new Map<string, HTMLLIElement>();
  const refresh = (): void => {
    const ids = store.ids();
    summary.textContent = `내 즐겨찾기 (${ids.length})`;
    empty.hidden = ids.length > 0;
    list.replaceChildren(...ids.flatMap((id) => {
      const place = byId.get(id);
      if (!place) return [];
      let row = rows.get(id);
      if (!row) {
        row = document.createElement('li');
        row.className = 'favourite-place';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'favourite-open';
        button.textContent = place.name;
        button.addEventListener('click', () => { onSelect(id); });
        const address = document.createElement('p');
        address.textContent = place.address;
        row.append(button, address, renderPlaceMapLinks(place));
        rows.set(id, row);
      }
      return [row];
    }));
  };
  refresh();
  return refresh;
}

export function renderFavouriteToggle(
  container: HTMLElement,
  id: string,
  store: Favourites,
  onChange: () => void,
): void {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'favourite-toggle';
  const status = document.createElement('p');
  status.className = 'favourite-status';
  status.setAttribute('role', 'status');
  const refresh = (): void => {
    button.textContent = store.has(id) ? '즐겨찾기 해제' : '즐겨찾기 추가';
    button.setAttribute('aria-pressed', String(store.has(id)));
  };
  button.disabled = !store.readable;
  if (!store.readable) status.textContent = READ_FAILURE;
  button.addEventListener('click', () => {
    if (!store.toggle(id)) {
      status.textContent = '변경 내용을 저장하지 못했습니다. 브라우저의 저장소 설정을 확인한 뒤 다시 시도해 주세요.';
      return;
    }
    refresh();
    status.textContent = store.has(id) ? '즐겨찾기에 추가했습니다.' : '즐겨찾기를 해제했습니다.';
    onChange();
  });
  refresh();
  const notice = document.createElement('p');
  notice.className = 'favourites-notice';
  notice.textContent = FAVOURITES_NOTICE;
  container.append(button, status, notice);
}
