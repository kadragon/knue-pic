import type { PlaceRecord } from '../data/types';
import { renderPlaceLocationMap, type ReleasePlaceLocationMap } from '../map/place-map';
import { DETAIL_HEADING, renderPlaceDetail, type PlaceDetail } from './place-detail';

/**
 * The detail card as a modal dialog rather than the last section of the page.
 *
 * It was a section until a UI review found the defect: selecting a place from any list rendered the
 * card ~3,400px down the page and moved focus to it, so every act of curiosity was a one-way trip
 * past every other section, comparing two places meant a scroll shuttle, and the bottom of the page
 * was permanently anchored by an empty card explaining a feature the visitor had not used yet.
 *
 * `renderPlaceDetail` is unchanged and still owns every string and figure; this module owns only
 * the shell around it — scrim, close control, focus containment, and restoring focus on close.
 *
 * A hand-built dialog rather than `<dialog>`: `showModal` gives focus containment for free, but its
 * jsdom support is uneven, and the focus behaviour here is the part most worth having under test.
 */

export const CLOSE_LABEL = '닫기';

export interface DetailDialogOptions {
  /**
   * Fills the card's map slot. Injectable for the same reason `renderPlaceLocationMap` takes a
   * `loadApi`: jsdom cannot run the Naver script, and the dialog's own behaviour — focus, Escape,
   * the figures — is the part worth testing without one.
   *
   * May resolve with a release function; the dialog calls it before the next render and on close.
   */
  renderMap?: (
    container: HTMLElement,
    place: PlaceRecord,
  ) => void | ReleasePlaceLocationMap | Promise<void | ReleasePlaceLocationMap>;
}

export interface DetailDialogHandle {
  /** Renders `detail` and shows the dialog. Calling it while open just swaps the contents. */
  open: (detail: PlaceDetail) => void;
  close: () => void;
  isOpen: () => boolean;
  /**
   * Re-renders an already-open dialog with new figures for the same selection. A no-op when
   * closed, so a repaint never pops the dialog open on its own. Nothing in the page drives it
   * today — the window a place is shown under is now fixed by the column it was picked from.
   */
  update: (detail: PlaceDetail) => void;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Builds the dialog once and reuses it. Rebuilding per selection would replace the node holding
 * focus, which is the failure every other module in `src/ui/` is written to avoid.
 */
export function createDetailDialog(
  container: HTMLElement,
  options: DetailDialogOptions = {},
): DetailDialogHandle {
  const { renderMap = renderPlaceLocationMap } = options;

  const root = document.createElement('div');
  root.className = 'detail-dialog';
  root.hidden = true;

  const scrim = document.createElement('div');
  scrim.className = 'detail-dialog-scrim';

  const panel = document.createElement('div');
  panel.className = 'detail-dialog-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  // Named by the card's own `<h2>` ("선택한 곳"), which `renderPlaceDetail` writes on every render.
  panel.setAttribute('aria-label', DETAIL_HEADING);
  // Focused on open; never a tab stop of its own.
  panel.tabIndex = -1;

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'detail-dialog-close';
  close.textContent = CLOSE_LABEL;

  const body = document.createElement('div');
  body.className = 'detail-dialog-body';

  panel.append(close, body);
  root.append(scrim, panel);
  container.replaceChildren(root);

  /** The control that opened the dialog, so closing can hand focus back to where it came from. */
  let opener: HTMLElement | null = null;

  /** Where focus goes when there is no opener to return it to: the content region around us. */
  function fallback(): HTMLElement | null {
    return container.closest<HTMLElement>('#content');
  }

  /**
   * Releases the map currently mounted in the card, if any.
   *
   * Every paint discards the card's DOM and mounts a fresh map, so without this a reader who opens
   * thirty places leaves thirty live map instances behind — each still holding the listeners and
   * tile state the API attached to a node that is no longer in the document. The page-level map
   * this replaced was built once and never had the problem.
   */
  let releaseMap: ReleasePlaceLocationMap | null = null;

  /**
   * Which paint the stored release belongs to.
   *
   * `isOpen()` alone is not enough to decide whether a resolved mount is still the current one: a
   * reader who closes and reopens on a different row before the first mount lands has an open
   * dialog again, and storing the stale release there overwrites — never spends — the live one,
   * leaking exactly the map instance this plumbing exists to reclaim.
   */
  let paintId = 0;

  function dropMap(): void {
    releaseMap?.();
    releaseMap = null;
  }

  function isOpen(): boolean {
    return !root.hidden;
  }

  function closeDialog(): void {
    if (!isOpen()) return;
    root.hidden = true;
    // Invalidates any mount still in flight: its release is spent on arrival instead of being
    // stored against whatever the dialog is showing by then.
    paintId += 1;
    dropMap();
    document.removeEventListener('keydown', onKeydown, true);
    // Restoring focus is the whole point of holding `opener`: without it the caret drops to the top
    // of the document and a keyboard user has to tab back through the entire list they came from.
    // `isConnected` guards the case where the list was re-rendered while the dialog was open.
    if (opener?.isConnected) {
      opener.focus();
    } else {
      // No opener to go back to — a programmatic open, or the row was re-rendered underneath. Focus
      // must not be left on the panel we just hid: an element inside a `hidden` subtree is not
      // focusable, so a screen reader would be parked on nothing.
      panel.blur();
      fallback()?.focus();
    }
    opener = null;
  }

  /**
   * Captured on `document` so Escape works wherever focus sits, and so Tab can be contained without
   * relying on the panel being an ancestor of the active element.
   */
  function onKeydown(event: KeyboardEvent): void {
    if (!isOpen()) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      closeDialog();
      return;
    }

    if (event.key !== 'Tab') return;

    const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (focusable.length === 0) {
      event.preventDefault();
      panel.focus();
      return;
    }

    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = document.activeElement;

    // Wrapping by hand rather than trusting the DOM order: the dialog sits at the end of `#content`
    // but is visually on top of it, so an uncontained Tab walks into the page behind the scrim.
    if (event.shiftKey && (active === first || active === panel)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    } else if (!panel.contains(active)) {
      event.preventDefault();
      first.focus();
    }
  }

  scrim.addEventListener('click', closeDialog);
  close.addEventListener('click', closeDialog);

  /**
   * Renders the card, then fills its map slot.
   *
   * The map is mounted after the figures rather than awaited before them: it is the one view that
   * depends on a third-party script, and the dialog must show the numbers whether or not that
   * script ever arrives (`docs/eval-criteria.md` → Graceful Degradation). `renderPlaceLocationMap`
   * resolves even on failure — it renders the documented fallback instead — so the `catch` is only
   * for an injected renderer that does not keep that promise.
   */
  function paint(detail: PlaceDetail): void {
    dropMap();
    renderPlaceDetail(body, detail);

    const slot = body.querySelector<HTMLElement>('.place-detail-map');
    if (!slot) return;

    // The mount is asynchronous, so the dialog can be closed — or repainted onto another place —
    // before it lands. A release is stored only while it is still the current paint's; every other
    // one is spent on arrival rather than stored and forgotten.
    const mountId = ++paintId;
    void Promise.resolve(renderMap(slot, detail.place))
      .then((release) => {
        if (typeof release !== 'function') return;
        if (isOpen() && mountId === paintId) {
          releaseMap = release;
        } else {
          release();
        }
      })
      .catch(() => {});
  }

  return {
    isOpen,
    close: closeDialog,
    update(detail) {
      if (!isOpen()) return;
      paint(detail);
    },
    open(detail) {
      const wasOpen = isOpen();
      paint(detail);

      if (wasOpen) {
        // Re-opening from a marker click while already open: keep the original opener so Escape
        // still returns focus to the list, and do not re-register the key handler.
        panel.focus();
        return;
      }

      const active = document.activeElement;
      opener = active instanceof HTMLElement && active !== document.body ? active : null;
      root.hidden = false;
      document.addEventListener('keydown', onKeydown, true);
      panel.focus();
    },
  };
}
