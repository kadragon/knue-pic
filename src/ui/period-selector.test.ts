import { describe, expect, it, vi } from 'vitest';
import {
  markSelectedPeriod,
  PERIOD_GROUP_LABEL,
  PERIOD_LABELS,
  renderPeriodSelector,
} from './period-selector';

function buttons(container: HTMLElement): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>('.period-option')];
}

describe('renderPeriodSelector', () => {
  it('offers all three periods in a labelled group', () => {
    const container = document.createElement('div');

    renderPeriodSelector(container, '1y', () => {});

    expect(container.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe(
      PERIOD_GROUP_LABEL,
    );
    expect(buttons(container).map((button) => button.textContent)).toEqual([
      PERIOD_LABELS['1m'],
      PERIOD_LABELS['6m'],
      PERIOD_LABELS['1y'],
    ]);
  });

  it('marks exactly one period as pressed', () => {
    const container = document.createElement('div');

    renderPeriodSelector(container, '6m', () => {});

    const pressed = buttons(container).filter(
      (button) => button.getAttribute('aria-pressed') === 'true',
    );
    expect(pressed).toHaveLength(1);
    expect(pressed[0]?.textContent).toBe(PERIOD_LABELS['6m']);
  });

  it('reports the chosen period to the caller', () => {
    const container = document.createElement('div');
    const onSelect = vi.fn();

    renderPeriodSelector(container, '1y', onSelect);
    buttons(container)[0]?.click();

    expect(onSelect).toHaveBeenCalledWith('1m');
  });

  it('uses native buttons so the control is keyboard-operable without ARIA', () => {
    const container = document.createElement('div');

    renderPeriodSelector(container, '1y', () => {});

    expect(buttons(container).every((button) => button.type === 'button')).toBe(true);
  });
});

describe('markSelectedPeriod', () => {
  it('moves the pressed state without replacing the buttons', () => {
    const container = document.createElement('div');
    renderPeriodSelector(container, '1y', () => {});
    const before = buttons(container)[0];

    markSelectedPeriod(container, '1m');

    // Same element instance: re-rendering here would drop focus off the button just pressed.
    expect(buttons(container)[0]).toBe(before);
    expect(before?.getAttribute('aria-pressed')).toBe('true');
    expect(buttons(container)[2]?.getAttribute('aria-pressed')).toBe('false');
  });
});
