import { describe, expect, it, vi } from 'vitest';
import { MAP_ERROR_MESSAGE } from '../map/place-map';
import {
  DISCLAIMER,
  RECENTRE_LABEL,
  SOURCE_LINE,
  mapCoveredInsets,
  renderShell,
  setShellMapFirst,
  setShellMapUnavailable,
  setShellUpdatedAt,
} from './shell';

describe('renderShell', () => {
  it('always shows the data source line and the usage disclaimer', () => {
    const root = document.createElement('div');

    renderShell(root);

    expect(root.textContent).toContain(SOURCE_LINE);
    expect(root.textContent).toContain(DISCLAIMER);
  });

  it('puts the provenance above the content slot, not below it', () => {
    const root = document.createElement('div');

    renderShell(root, { updatedAt: '2026-08-01' });

    // The ranked list runs to hundreds of rows. Provenance placed after `#content` is reachable
    // only by scrolling past all of them, which is what PRD §21's "every screen" rules out — so
    // the assertion is on the order, not merely on the strings being present somewhere.
    const provenance = root.querySelector('.shell-provenance');
    const content = root.querySelector('#content');
    expect(provenance).not.toBeNull();
    expect(content).not.toBeNull();
    expect(provenance?.textContent).toContain(SOURCE_LINE);
    expect(provenance?.textContent).toContain(DISCLAIMER);
    expect(provenance?.textContent).toContain('데이터 기준일: 2026년 8월 1일');
    const order = [...root.querySelector('.sheet-scroll')!.children].map((child) => child.className || child.id);
    expect(order.indexOf('shell-provenance')).toBeLessThan(order.indexOf('content'));
    // Moved, not replaced: `<footer>` is the page's only `contentinfo` landmark, and it is what a
    // screen reader user jumps to in order to reach the source line and the §21 disclaimer. A
    // `<section>` here would render identically and expose no landmark at all, so the element name
    // is asserted rather than left to the class.
    expect(provenance?.tagName).toBe('FOOTER');
  });

  it('shows the update date only when the dataset provides one', () => {
    const withDate = document.createElement('div');
    renderShell(withDate, { updatedAt: '2026-08-01' });
    expect(withDate.textContent).toContain('데이터 기준일: 2026년 8월 1일');

    const withoutDate = document.createElement('div');
    renderShell(withoutDate);
    expect(withoutDate.textContent).not.toContain('데이터 기준일');
  });

  it('rewrites the update date in place instead of adding a second line', () => {
    const root = document.createElement('div');
    renderShell(root, { updatedAt: '2026-07-01' });
    const line = root.querySelector('.shell-updated');

    setShellUpdatedAt(root, '2026-08-01');

    // Same node, new text: a dataset arriving after the frame is up must not stack provenance
    // lines, and the band order source → updated → disclaimer has to survive the rewrite.
    expect(root.querySelector('.shell-updated')).toBe(line);
    expect(root.querySelectorAll('.shell-updated')).toHaveLength(1);
    expect(root.textContent).toContain('데이터 기준일: 2026년 8월 1일');
    expect(root.textContent).not.toContain('2026년 7월 1일');
    const bandText = [...root.querySelectorAll('.shell-provenance p')].map((p) => p.className);
    expect(bandText).toEqual(['', 'shell-updated', 'shell-disclaimer']);
  });

  it('leaves an empty content slot for feature views', () => {
    const root = document.createElement('div');

    renderShell(root);

    const content = root.querySelector('#content');
    expect(content).not.toBeNull();
    expect(content?.childElementCount).toBe(0);
  });
});

/**
 * The map-first frame: the map is the page and the content is a panel beside it
 * (`docs/design/map-first-layout.md`). The frame owns the layout and the fallback, not the map —
 * `src/ui/bootstrap.ts` mounts into the region and tells this module when the map will not come.
 */
describe('renderShell map-first frame', () => {
  function mapRegion(root: HTMLElement): HTMLElement | null {
    return root.querySelector('.map-shell-map');
  }

  it('leaves a map region for the map to mount into, and no map in it yet', () => {
    const root = document.createElement('div');

    renderShell(root, { mapFirst: true, onRecentre: () => {} });

    // The region exists from the first paint, so a reader never sees the list shift sideways when
    // the map arrives — and nothing draws into it until the script has loaded.
    expect(mapRegion(root)).not.toBeNull();
    expect(root.querySelector('.page-map-canvas')).toBeNull();
    expect([...(mapRegion(root)?.children ?? [])].map((child) => child.className)).toEqual([
      'map-recentre',
    ]);
  });

  it('marks a wide viewport as map-first and leaves a narrow one alone', () => {
    const wide = document.createElement('div');
    renderShell(wide, { mapFirst: true, onRecentre: () => {} });

    const narrow = document.createElement('div');
    renderShell(narrow, { mapFirst: false, onRecentre: () => {} });

    // The layout flag is explicit; bootstrap requests the map at every width.
    expect(wide.classList.contains('is-map-first')).toBe(true);
    expect(narrow.classList.contains('is-map-first')).toBe(false);
    expect(mapRegion(narrow)).not.toBeNull();
  });

  it('puts the content slot before the map region, so a keyboard walk meets the content first', () => {
    const root = document.createElement('div');

    renderShell(root, { mapFirst: true, onRecentre: () => {} });

    expect(root.firstElementChild?.className).toBe('sheet-panel');
    expect(root.lastElementChild?.className).toBe('map-shell-map');
  });

  it('recentres the map through the 학교로 control', () => {
    const root = document.createElement('div');
    const recentre = vi.fn();

    renderShell(root, { mapFirst: true, onRecentre: recentre });
    mapRegion(root)?.querySelector<HTMLButtonElement>('.map-recentre')?.click();

    // The button is the reader's way back to the campus after panning off into 대전; the shell has
    // no map to move, so it hands the press on.
    expect(mapRegion(root)?.querySelector('.map-recentre')?.textContent).toBe(RECENTRE_LABEL);
    expect(recentre).toHaveBeenCalledTimes(1);
  });

  it('renders no recentre control when there is nothing to recentre', () => {
    const root = document.createElement('div');

    renderShell(root, { mapFirst: true });

    // A button that does nothing is a tab stop onto a dead end.
    expect(root.querySelector('.map-recentre')).toBeNull();
  });

  it('flips the layout back to today\'s when a narrow window comes back to wide', () => {
    const root = document.createElement('div');
    renderShell(root, { mapFirst: false, onRecentre: () => {} });

    setShellMapFirst(root, true);
    expect(root.classList.contains('is-map-first')).toBe(true);

    setShellMapFirst(root, false);
    expect(root.classList.contains('is-map-first')).toBe(false);
    // The layout flipped; the region and its control are still there for the next widening.
    expect(mapRegion(root)).not.toBeNull();
    expect(root.querySelector('.map-recentre')).not.toBeNull();
  });
});

/**
 * The one degraded state: whatever failed, the reader gets today's full-width page with a single
 * line saying the map is not there. Everything the panel does keeps working.
 */
describe('setShellMapUnavailable', () => {
  it('takes the map region away and says so once, at the top of the content', () => {
    const root = document.createElement('div');
    renderShell(root, { mapFirst: true, onRecentre: () => {} });
    const content = root.querySelector<HTMLElement>('#content') ?? null;
    expect(content).not.toBeNull();
    content?.append(document.createElement('p'));

    setShellMapUnavailable(root);

    expect(root.querySelector('.map-shell-map')).toBeNull();
    expect(root.classList.contains('is-map-first')).toBe(false);
    const notes = root.querySelectorAll('.shell-map-note');
    expect(notes).toHaveLength(1);
    expect(notes[0]?.textContent).toBe(MAP_ERROR_MESSAGE);
    // Above the summary line, not under the list: the reader should learn that the map is gone at
    // the moment they look for it.
    expect(content?.firstElementChild).toBe(notes[0]);
    // The map arrives asynchronously, so the failure would otherwise pass silently for a
    // screen-reader user.
    expect(notes[0]?.getAttribute('role')).toBe('status');
  });

  it('says it once however often the failure arrives', () => {
    const root = document.createElement('div');
    renderShell(root, { mapFirst: true, onRecentre: () => {} });

    setShellMapUnavailable(root);
    setShellMapUnavailable(root);

    // One sentence, one layout change: the load rejection and the auth-failure hook can both fire
    // for one mount, and the page may only answer once.
    expect(root.querySelectorAll('.shell-map-note')).toHaveLength(1);
  });

  it('keeps the content and search working', () => {
    const root = document.createElement('div');
    renderShell(root, { mapFirst: true, onRecentre: () => {} });
    const search = document.createElement('div');
    search.className = 'search-slot';
    root.querySelector('#content')?.append(search);

    setShellMapUnavailable(root);

    expect(root.querySelector('.search-slot')).toBe(search);
    expect(root.textContent).toContain(SOURCE_LINE);
    expect(root.textContent).toContain(DISCLAIMER);
  });

  it('falls back even when the layout was already narrowed before the failure arrived', () => {
    const root = document.createElement('div');
    renderShell(root, { mapFirst: true, onRecentre: () => {} });

    // A map was mounted, so a failure is a failure whatever the reader has resized to. Keying this
    // on the layout class instead would drop it, and widening the window would then show a panel
    // beside a map that never came.
    setShellMapFirst(root, false);
    setShellMapUnavailable(root);

    expect(root.querySelectorAll('.shell-map-note')).toHaveLength(1);
    expect(root.querySelector('.map-shell-map')).toBeNull();
  });

  it('does nothing to a shell that never had a map', () => {
    const root = document.createElement('div');
    renderShell(root, { mapFirst: false });

    setShellMapUnavailable(root);

    // Nothing was mounted, so nothing failed — and the caller below the breakpoint is the one that
    // knows that: `setShellMapUnavailable` applies a transition it was asked for, and a reader on a
    // phone is never asked. Only the second call is a no-op here, which the case above covers.
    expect(root.querySelectorAll('.shell-map-note')).toHaveLength(1);

    const second = document.createElement('div');
    renderShell(second, { mapFirst: true, onRecentre: () => {} });
    setShellMapUnavailable(second);
    setShellMapUnavailable(second);
    expect(second.querySelectorAll('.shell-map-note')).toHaveLength(1);
  });
});

/**
 * What the page draws over the map, measured from the boxes it laid out. jsdom lays nothing out, so
 * each case stubs the rects a real layout produced: 360×640 with the sheet half open, 1440×900 with
 * the masthead and the 360px column (observed 2026-10-04 at `localhost:5173`).
 */
describe('mapCoveredInsets', () => {
  function shell(rects: Record<string, [number, number, number, number]>, floating = false) {
    const root = document.createElement('div');
    renderShell(root, { mapFirst: true });
    // jsdom loads no stylesheet; the peek rule's `position: fixed` is set where it would compute.
    if (floating) root.querySelector<HTMLElement>('.shell-provenance')!.style.position = 'fixed';
    for (const [selector, [left, top, right, bottom]] of Object.entries(rects)) {
      vi.spyOn(root.querySelector(selector)!, 'getBoundingClientRect').mockReturnValue({
        left, top, right, bottom, width: right - left, height: bottom - top,
      } as DOMRect);
    }
    return root;
  }

  it('reads the bottom-anchored sheet as a bottom inset', () => {
    const root = shell({
      '.map-shell-map': [0, 0, 360, 640],
      '.sheet-panel': [0, 320, 360, 640],
      '.shell-provenance': [0, 420, 360, 520],
    });
    expect(mapCoveredInsets(root)).toEqual({ top: 0, right: 0, bottom: 320, left: 0 });
  });

  it('ignores provenance the sheet has scrolled up out of its own view', () => {
    // Half open, the detail scrolled: the card's box sits above the sheet's top edge, clipped by the
    // sheet's own scroller — it covers nothing (observed 2026-10-04: the pin landed 59px low).
    const root = shell({
      '.map-shell-map': [0, 0, 360, 640],
      '.sheet-panel': [0, 320, 360, 640],
      '.shell-provenance': [0, 18, 360, 118],
    });
    expect(mapCoveredInsets(root)).toEqual({ top: 0, right: 0, bottom: 320, left: 0 });
  });

  it('adds the provenance card a collapsed sheet floats over the top of the map', () => {
    const root = shell({
      '.map-shell-map': [0, 0, 360, 640],
      '.sheet-panel': [0, 536, 360, 640],
      '.shell-provenance': [16, 76, 344, 180],
    }, true);
    expect(mapCoveredInsets(root)).toEqual({ top: 180, right: 0, bottom: 104, left: 0 });
  });

  it('reads the desktop masthead as a top inset and the column as a left one', () => {
    const root = shell({
      '.map-shell-map': [0, 0, 1440, 900],
      '.sheet-panel': [0, 0, 1440, 1964],
      '.shell-provenance': [0, 97, 1440, 196],
      '#content': [0, 196, 360, 1964],
    });
    expect(mapCoveredInsets(root)).toEqual({ top: 196, right: 0, bottom: 0, left: 360 });
  });

  it('lets the masthead go once the page has scrolled it away', () => {
    const root = shell({
      '.map-shell-map': [0, 0, 1440, 900],
      '.sheet-panel': [0, -600, 1440, 1364],
      '.shell-provenance': [0, -503, 1440, -404],
      '#content': [0, -404, 360, 1364],
    });
    expect(mapCoveredInsets(root)).toEqual({ top: 0, right: 0, bottom: 0, left: 360 });
  });

  it('reports nothing once the map region is gone', () => {
    const root = document.createElement('div');
    renderShell(root, { mapFirst: true });
    setShellMapUnavailable(root);
    expect(mapCoveredInsets(root)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });
});
