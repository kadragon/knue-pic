import { describe, expect, it } from 'vitest';
import { SAMPLE_DATASET } from '../data/fixtures/sample-dataset';
import { computeMonthlyHistogram } from '../stats/histogram';
import { computePlaceStats } from '../stats/place-stats';
import { resolvePeriodWindow } from '../stats/period';
import { CLOSE_LABEL, createDetailDialog } from './detail-dialog';
import type { PlaceDetail } from './place-detail';

function detailFor(index = 0, period: '1m' | '6m' | '1y' = '1y'): PlaceDetail {
  const place = SAMPLE_DATASET.places[index]!;
  return {
    place,
    period,
    stats: computePlaceStats(place, resolvePeriodWindow(period, SAMPLE_DATASET.updatedAt)),
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
