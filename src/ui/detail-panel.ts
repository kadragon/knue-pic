import type { Period } from '../data/types';
import { renderPlaceDetail, type PlaceDetail } from './place-detail';

export interface DetailPanelOptions {
  resolve: (placeId: string, basis?: Period) => PlaceDetail | null;
  onSelection: (detail: PlaceDetail | null) => void;
}

export interface DetailPanelHandle {
  open(detail: PlaceDetail): void;
  syncHash(): void;
  release(): void;
}

function historyState(): Record<string, unknown> {
  const state: unknown = history.state;
  return typeof state === 'object' && state !== null ? state as Record<string, unknown> : {};
}

/** Validated history metadata preserves figures without adding anything beyond the id to the URL. */
function selectionState(placeId: string): { basis?: Period; fromList: boolean } {
  const state = historyState()['knuePickDetail'];
  if (typeof state !== 'object' || state === null) return { fromList: false };
  const route = state as Record<string, unknown>;
  if (route['placeId'] !== placeId) return { fromList: false };
  const basis = route['basis'];
  return {
    ...(basis === '1m' || basis === '3m' || basis === '6m' || basis === '1y' ? { basis } : {}),
    fromList: route['fromList'] === true,
  };
}

/** One selection across URL navigation and the desktop panel / mobile sheet boundary. */
export function createDetailPanel(
  container: HTMLElement,
  listViews: HTMLElement[],
  options: DetailPanelOptions,
): DetailPanelHandle {
  let selection: PlaceDetail | null = null;
  let opener: HTMLElement | null = null;
  let fromList = false;
  let pendingBack = false;
  let queuedSelection: PlaceDetail | null = null;

  function restoreFocus(): void {
    if (opener?.isConnected) opener.focus();
    else container.closest<HTMLElement>('#content')?.focus();
    opener = null;
  }

  function close(): void {
    if (fromList) {
      pendingBack = true;
      history.back();
    }
    else {
      const state = historyState();
      delete state['knuePickDetail'];
      history.replaceState(state, '', location.pathname + location.search);
    }
    fromList = false;
    show(null);
  }

  function paint(): void {
    listViews.forEach((view) => { view.hidden = selection !== null; });
    container.replaceChildren();
    if (!selection) return;

    const panel = document.createElement('div');
    panel.className = 'detail-panel';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'detail-panel-back';
    back.textContent = '← 목록';
    back.addEventListener('click', close);
    const body = document.createElement('div');
    renderPlaceDetail(body, selection, { withMap: false });
    panel.append(back, body);
    container.append(panel);
    body.querySelector<HTMLElement>('.place-detail')?.focus();
  }

  function show(next: PlaceDetail | null): void {
    if ((!next && !selection) ||
      (next && selection && next.place.id === selection.place.id && next.basis === selection.basis)) return;
    if (next && !selection) {
      const active = document.activeElement;
      opener = active instanceof HTMLElement && active !== document.body ? active : null;
    }
    const wasSelected = selection !== null;
    selection = next;
    paint();
    options.onSelection(selection);
    if (!selection && wasSelected) restoreFocus();
  }

  function syncHash(): void {
    let id: string | null = null;
    try {
      if (location.hash.startsWith('#place=')) id = decodeURIComponent(location.hash.slice(7));
    } catch { /* A malformed shared URL is an unknown selection, never a load error. */ }
    const route = id === null ? { fromList: false } : selectionState(id);
    fromList = route.fromList;
    show(id === null ? null : options.resolve(id, route.basis));
  }

  function onHashChange(): void {
    if (!container.isConnected) return;
    syncHash();
    pendingBack = false;
    const queued = queuedSelection;
    queuedSelection = null;
    if (queued) open(queued);
  }
  window.addEventListener('hashchange', onHashChange);

  paint();
  return {
    syncHash,
    release() {
      window.removeEventListener('hashchange', onHashChange);
      container.replaceChildren();
      selection = null;
      pendingBack = false;
      queuedSelection = null;
      options.onSelection(null);
      listViews.forEach((view) => { view.hidden = false; });
    },
    open,
  };

  function open(detail: PlaceDetail): void {
    if (pendingBack) {
      queuedSelection = detail;
      return;
    }
    const hash = `#place=${encodeURIComponent(detail.place.id)}`;
    if (!selection) fromList = true;
    const state = { ...historyState(), knuePickDetail: {
      placeId: detail.place.id, basis: detail.basis, fromList,
    } };
    // A second place replaces the detail entry; one Back reaches the originating list.
    if (selection) history.replaceState(state, '', hash);
    else history.pushState(state, '', hash);
    show(detail);
  }
}
