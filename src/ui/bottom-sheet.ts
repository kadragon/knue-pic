/** Three height stops; no data or selection state belongs to the sheet. */
const STOPS = ['peek', 'half', 'full'] as const;
const LABELS = ['접힘', '절반', '전체'];

/**
 * Fired on the panel, bubbling, each time the sheet settles on a stop — never mid-drag. The sheet
 * covers a different share of the map at each stop, and the map is the one that must react; the
 * sheet only says that it moved.
 */
export const SHEET_SNAP_EVENT = 'sheetsnap';

export function createBottomSheet(panel: HTMLElement, scroll: HTMLElement): HTMLButtonElement {
  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = 'sheet-handle';
  handle.setAttribute('role', 'slider');
  handle.setAttribute('aria-label', '목록 높이');
  handle.setAttribute('aria-controls', 'content');
  handle.setAttribute('aria-orientation', 'vertical');
  handle.setAttribute('aria-valuemin', '1');
  handle.setAttribute('aria-valuemax', '3');
  let index = 1;
  let drag: { id: number; y: number; height: number; stops: number[]; moved: boolean } | null = null;
  let suppressClick = false;

  function snap(next: number): void {
    index = Math.max(0, Math.min(2, next));
    panel.dataset['snap'] = STOPS[index];
    panel.style.removeProperty('--sheet-drag-height');
    handle.setAttribute('aria-valuenow', String(index + 1));
    handle.setAttribute('aria-valuetext', LABELS[index]!);
    handle.textContent = `목록 · ${LABELS[index]}`;
    panel.dispatchEvent(new Event(SHEET_SNAP_EVENT, { bubbles: true }));
  }

  function heights(): number[] {
    // Measure the CSS stops once per gesture, including dynamic viewport units and tokens.
    const stops = STOPS.map((stop) => {
      panel.dataset['snap'] = stop;
      return panel.getBoundingClientRect().height;
    });
    panel.dataset['snap'] = STOPS[index];
    return stops;
  }

  handle.addEventListener('click', (event) => {
    if (suppressClick && event.detail > 0) { suppressClick = false; return; }
    suppressClick = false;
    snap((index + 1) % STOPS.length);
  });
  handle.addEventListener('keydown', (event) => {
    const next = event.key === 'ArrowUp' || event.key === 'ArrowRight' ? index + 1
      : event.key === 'ArrowDown' || event.key === 'ArrowLeft' ? index - 1
      : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : null;
    if (next === null) return;
    event.preventDefault();
    snap(next);
  });
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !event.isPrimary) return;
    suppressClick = false;
    const stops = heights();
    drag = { id: event.pointerId, y: event.clientY,
      height: stops[index]!, stops, moved: false };
    handle.setPointerCapture?.(event.pointerId);
  });
  handle.addEventListener('pointermove', (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    const delta = drag.y - event.clientY;
    drag.moved ||= Math.abs(delta) > 6;
    if (!drag.moved) return;
    const stops = drag.stops;
    const height = Math.max(stops[0]!, Math.min(stops[2]!, drag.height + delta));
    panel.style.setProperty('--sheet-drag-height', `${height}px`);
  });
  function finish(event: PointerEvent, cancelled: boolean): void {
    if (!drag || drag.id !== event.pointerId) return;
    const previous = drag;
    drag = null;
    suppressClick = previous.moved && !cancelled;
    if (cancelled || !previous.moved) { snap(index); return; }
    const height = previous.height + previous.y - event.clientY;
    const distances = previous.stops.map((stop) => Math.abs(stop - height));
    snap(distances.indexOf(Math.min(...distances)));
  }
  handle.addEventListener('pointerup', (event) => { finish(event, false); });
  handle.addEventListener('pointercancel', (event) => { finish(event, true); });
  handle.addEventListener('lostpointercapture', (event) => { finish(event, true); });
  // Tabbing out of a collapsed sheet must reveal the focused control rather than clip it.
  scroll.addEventListener('focusin', () => { if (index === 0) snap(1); });
  snap(1);
  return handle;
}
