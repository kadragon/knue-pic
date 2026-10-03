import { createDetailDialog, type DetailDialogHandle, type DetailDialogOptions } from './detail-dialog';
import { renderPlaceDetail, type PlaceDetail } from './place-detail';

export interface DetailPanelOptions {
  wide: () => boolean;
  resolve: (placeId: string) => PlaceDetail | null;
  dialog: DetailDialogOptions;
  onSelection: (detail: PlaceDetail | null) => void;
}

export interface DetailPanelHandle {
  open(detail: PlaceDetail): void;
  syncLayout(): void;
  syncHash(): void;
}

/** One selection across URL navigation and the desktop panel / mobile dialog boundary. */
export function createDetailPanel(
  container: HTMLElement,
  listViews: HTMLElement[],
  options: DetailPanelOptions,
): DetailPanelHandle {
  let selection: PlaceDetail | null = null;
  let opener: HTMLElement | null = null;
  let dialog: DetailDialogHandle | null = null;
  let switching = false;

  function restoreFocus(): void {
    if (opener?.isConnected) opener.focus();
    else container.closest<HTMLElement>('#content')?.focus();
    opener = null;
  }

  function clearDialog(): void {
    switching = true;
    dialog?.close();
    dialog = null;
    switching = false;
    container.replaceChildren();
  }

  function close(): void {
    if (switching) return;
    history.replaceState(history.state, '', location.pathname + location.search);
    show(null);
  }

  function paint(): void {
    clearDialog();
    const panelMode = options.wide();
    listViews.forEach((view) => { view.hidden = panelMode && selection !== null; });
    if (!panelMode) {
      dialog = createDetailDialog(container, { ...options.dialog, onClose: close });
      if (selection) dialog.open(selection);
      return;
    }
    if (!selection) return;

    const panel = document.createElement('div');
    panel.className = 'detail-panel';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'detail-panel-back';
    back.textContent = '← 목록';
    back.addEventListener('click', close);
    const body = document.createElement('div');
    renderPlaceDetail(body, selection);
    // The page map answers location on desktop; figures, chart and links keep their existing DOM.
    body.querySelector('.place-detail-map')?.remove();
    panel.append(back, body);
    container.append(panel);
    body.querySelector<HTMLElement>('.place-detail')?.focus();
  }

  function show(next: PlaceDetail | null): void {
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
    show(id === null ? null : options.resolve(id));
  }

  window.addEventListener('hashchange', () => {
    // A bootstrapped view may have been replaced (or removed by a test); detached views never
    // navigate or steal focus from the current page.
    if (container.isConnected) syncHash();
  });

  paint();
  return {
    syncHash,
    syncLayout: paint,
    open(detail) {
      const hash = `#place=${encodeURIComponent(detail.place.id)}`;
      // A second place replaces the detail entry; one Back always reaches the originating list.
      if (selection) history.replaceState(history.state, '', hash);
      else history.pushState(null, '', hash);
      show(detail);
    },
  };
}
