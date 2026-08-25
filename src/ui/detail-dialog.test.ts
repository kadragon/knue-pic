import { describe, expect, it } from 'vitest';
import { SAMPLE_DATASET } from '../data/fixtures/sample-dataset';
import { computeMonthlyHistogram } from '../stats/histogram';
import { computePlaceStats } from '../stats/place-stats';
import { resolvePeriodWindow } from '../stats/period';
import type { Period } from '../data/types';
import { CLOSE_LABEL, createDetailDialog } from './detail-dialog';
import type { PlaceDetail } from './place-detail';

function detailFor(index = 0, basis: Period = '1y'): PlaceDetail {
  const place = SAMPLE_DATASET.places[index]!;
  return {
    place,
    basis,
    stats: computePlaceStats(place, resolvePeriodWindow(basis, SAMPLE_DATASET.updatedAt)),
    histogram: computeMonthlyHistogram(place, SAMPLE_DATASET.updatedAt),
  };
}

function mount(): { container: HTMLElement; opener: HTMLButtonElement } {
  const container = document.createElement('div');
  const opener = document.createElement('button');
  opener.type = 'button';
  document.body.append(opener, container);
  return { container, opener };
}

describe('createDetailDialog', () => {
  it('starts hidden so the page does not end in an empty card', () => {
    const { container } = mount();

    createDetailDialog(container);

    expect(container.querySelector<HTMLElement>('.detail-dialog')?.hidden).toBe(true);
    expect(container.textContent).not.toContain(CLOSE_LABEL.repeat(2));
    document.body.replaceChildren();
  });

  it('shows the place and moves focus into the panel', () => {
    const { container, opener } = mount();
    const dialog = createDetailDialog(container);

    opener.focus();
    dialog.open(detailFor(0));

    expect(dialog.isOpen()).toBe(true);
    expect(container.textContent).toContain(SAMPLE_DATASET.places[0]!.name);
    expect(document.activeElement).toBe(container.querySelector('.detail-dialog-panel'));
    document.body.replaceChildren();
  });

  it('closes on Escape and hands focus back to whatever opened it', () => {
    const { container, opener } = mount();
    const dialog = createDetailDialog(container);

    opener.focus();
    dialog.open(detailFor(0));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(dialog.isOpen()).toBe(false);
    expect(document.activeElement).toBe(opener);
    document.body.replaceChildren();
  });

  it('closes when the scrim is clicked', () => {
    const { container, opener } = mount();
    const dialog = createDetailDialog(container);

    opener.focus();
    dialog.open(detailFor(0));
    container.querySelector<HTMLElement>('.detail-dialog-scrim')?.click();

    expect(dialog.isOpen()).toBe(false);
    expect(document.activeElement).toBe(opener);
    document.body.replaceChildren();
  });

  it('keeps Tab inside the panel', () => {
    const { container, opener } = mount();
    const dialog = createDetailDialog(container);

    opener.focus();
    dialog.open(detailFor(0));

    // Focus sits on the panel itself right after opening; a shift-Tab from there would otherwise
    // walk into the list behind the scrim.
    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(container.querySelector('.detail-dialog-panel')?.contains(document.activeElement)).toBe(
      true,
    );
    document.body.replaceChildren();
  });

  it('repaints an open dialog when the period changes, and ignores update while closed', () => {
    const { container, opener } = mount();
    const dialog = createDetailDialog(container);

    dialog.update(detailFor(0, '1m'));
    expect(dialog.isOpen()).toBe(false);
    expect(container.textContent).not.toContain(SAMPLE_DATASET.places[0]!.name);

    opener.focus();
    dialog.open(detailFor(0, '1y'));
    dialog.update(detailFor(0, '1m'));

    expect(dialog.isOpen()).toBe(true);
    expect(container.querySelectorAll('.place-detail')).toHaveLength(1);
    document.body.replaceChildren();
  });

  it('stops listening for Escape once closed', () => {
    const { container, opener } = mount();
    const dialog = createDetailDialog(container);

    opener.focus();
    dialog.open(detailFor(0));
    dialog.close();
    const other = document.createElement('button');
    document.body.append(other);
    other.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    // A stale handler would have yanked focus back to the opener.
    expect(document.activeElement).toBe(other);
    document.body.replaceChildren();
  });

  it('does not leave focus on the hidden panel when nothing opened it', () => {
    const content = document.createElement('div');
    content.id = 'content';
    content.tabIndex = -1;
    const container = document.createElement('div');
    content.append(container);
    document.body.append(content);
    const dialog = createDetailDialog(container);

    // Opened with focus on the body — a marker click, or a programmatic open.
    dialog.open(detailFor(0));
    dialog.close();

    expect(document.activeElement).toBe(content);
    document.body.replaceChildren();
  });
});

describe('createDetailDialog map lifecycle', () => {
  /** A stand-in renderer that records what it mounted and what was released. */
  function trackingRenderer(): {
    renderMap: (container: HTMLElement, place: { id: string }) => Promise<() => void>;
    mounted: string[];
    released: string[];
  } {
    const mounted: string[] = [];
    const released: string[] = [];
    return {
      mounted,
      released,
      renderMap: (_container, place) => {
        mounted.push(place.id);
        return Promise.resolve(() => released.push(place.id));
      },
    };
  }

  it('releases the mounted map when the dialog closes', async () => {
    const { container } = mount();
    const tracker = trackingRenderer();
    const dialog = createDetailDialog(container, { renderMap: tracker.renderMap });

    dialog.open(detailFor(0));
    await Promise.resolve();
    dialog.close();

    // A map left mounted keeps the listeners and tile state the API attached to a card that is no
    // longer on screen; thirty selections would leave thirty of them.
    expect(tracker.mounted).toEqual([SAMPLE_DATASET.places[0]!.id]);
    expect(tracker.released).toEqual([SAMPLE_DATASET.places[0]!.id]);
    document.body.replaceChildren();
  });

  it('releases the previous map before mounting the next place', async () => {
    const { container } = mount();
    const tracker = trackingRenderer();
    const dialog = createDetailDialog(container, { renderMap: tracker.renderMap });

    dialog.open(detailFor(0));
    await Promise.resolve();
    dialog.open(detailFor(1));
    await Promise.resolve();

    expect(tracker.released).toEqual([SAMPLE_DATASET.places[0]!.id]);
    expect(tracker.mounted).toEqual([
      SAMPLE_DATASET.places[0]!.id,
      SAMPLE_DATASET.places[1]!.id,
    ]);
    document.body.replaceChildren();
  });

  it('spends a stale release when the dialog was reopened on another place first', async () => {
    const { container } = mount();
    const mounted: string[] = [];
    const released: string[] = [];
    const pending: Array<(release: () => void) => void> = [];
    const dialog = createDetailDialog(container, {
      renderMap: (_container, place) => {
        mounted.push(place.id);
        // Held open: the real mount takes a network round trip, which is the whole window this
        // race lives in.
        return new Promise<() => void>((resolve) => {
          pending.push(() => resolve(() => released.push(place.id)));
        });
      },
    });

    const [first, second] = [SAMPLE_DATASET.places[0]!.id, SAMPLE_DATASET.places[1]!.id];
    dialog.open(detailFor(0));
    dialog.close();
    dialog.open(detailFor(1));
    pending[0]!(() => {});
    await Promise.resolve();
    pending[1]!(() => {});
    await Promise.resolve();
    dialog.close();

    // The first map resolved into an open dialog showing a different place. Storing its release
    // there would overwrite the live one and leak the first map for the life of the page.
    expect(mounted).toEqual([first, second]);
    expect(released).toEqual([first, second]);
    document.body.replaceChildren();
  });

  it('spends a release that arrives after the dialog was already closed', async () => {
    const { container } = mount();
    const tracker = trackingRenderer();
    const dialog = createDetailDialog(container, { renderMap: tracker.renderMap });

    dialog.open(detailFor(0));
    // Closed while the mount was still in flight: storing the release would strand the map.
    dialog.close();
    await Promise.resolve();

    expect(tracker.released).toEqual([SAMPLE_DATASET.places[0]!.id]);
    document.body.replaceChildren();
  });
});
