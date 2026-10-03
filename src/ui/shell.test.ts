import { describe, expect, it, vi } from 'vitest';
import { MAP_ERROR_MESSAGE } from '../map/place-map';
import {
  DISCLAIMER,
  RECENTRE_LABEL,
  SOURCE_LINE,
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
    const order = [...root.children].map((child) => child.className || child.id);
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

    // Below the breakpoint the page is today's layout, and the class is what the stylesheet reads
    // to hold `#content` to the panel width — so it has to track the same answer the mount
    // decision did.
    expect(wide.classList.contains('is-map-first')).toBe(true);
    expect(narrow.classList.contains('is-map-first')).toBe(false);
    expect(mapRegion(narrow)).not.toBeNull();
  });

  it('puts the content slot before the map region, so a keyboard walk meets the content first', () => {
    const root = document.createElement('div');

    renderShell(root, { mapFirst: true, onRecentre: () => {} });

    const order = [...root.children].map((child) => child.className || child.id);
    expect(order.indexOf('content')).toBeLessThan(order.indexOf('map-shell-map'));
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

  it('keeps the content, the search and the dialog working', () => {
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

  it('does nothing to a shell that never had a map', () => {
    const root = document.createElement('div');
    renderShell(root, { mapFirst: false });

    setShellMapUnavailable(root);

    // Below the breakpoint no map was mounted, so nothing failed and there is nothing to say —
    // a reader on a phone must not be told the map is missing when they never had one.
    expect(root.querySelector('.shell-map-note')).toBeNull();
    expect(root.classList.contains('is-map-first')).toBe(false);
  });
});
