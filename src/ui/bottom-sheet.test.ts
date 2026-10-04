import { afterEach, describe, expect, it } from 'vitest';
import { renderShell, setShellMapUnavailable } from './shell';

function setup() {
  const root = document.createElement('div');
  document.body.append(root);
  renderShell(root, { mapFirst: true });
  const panel = root.querySelector<HTMLElement>('.sheet-panel')!;
  const handle = root.querySelector<HTMLButtonElement>('.sheet-handle')!;
  return { root, panel, handle };
}

function pointer(handle: HTMLElement, type: string, y: number, id = 1) {
  const event = new Event(type, { bubbles: true });
  Object.assign(event, { clientY: y, pointerId: id, button: 0, isPrimary: true });
  handle.dispatchEvent(event);
}

afterEach(() => { document.body.replaceChildren(); });

describe('mobile bottom sheet', () => {
  it('starts half open and exposes all three stops to keyboard users', () => {
    const { root, panel, handle } = setup();
    expect(panel.dataset['snap']).toBe('half');
    expect(handle.getAttribute('role')).toBe('slider');
    expect(handle.getAttribute('aria-valuenow')).toBe('2');
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    expect(panel.dataset['snap']).toBe('full');
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(panel.dataset['snap']).toBe('half');
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'End' }));
    expect(panel.dataset['snap']).toBe('peek');
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' }));
    expect(panel.dataset['snap']).toBe('full');
    root.remove();
  });

  it('cycles stops on a tap, keeping the list before search inside one scroll region', () => {
    const { root, panel, handle } = setup();
    handle.click(); expect(panel.dataset['snap']).toBe('full');
    handle.click(); expect(panel.dataset['snap']).toBe('peek');
    handle.click(); expect(panel.dataset['snap']).toBe('half');
    expect(root.querySelector('.sheet-scroll #content')).not.toBeNull();
    expect(root.querySelector('.sheet-scroll .shell-provenance')).not.toBeNull();
    root.remove();
  });

  it('drags to each stop without treating the final click as another snap', () => {
    const { root, panel, handle } = setup();
    pointer(handle, 'pointerdown', 400);
    pointer(handle, 'pointermove', 100);
    pointer(handle, 'pointerup', 100);
    expect(panel.dataset['snap']).toBe('full');
    handle.dispatchEvent(new MouseEvent('click', { detail: 1 }));
    expect(panel.dataset['snap']).toBe('full');
    pointer(handle, 'pointerdown', 100);
    pointer(handle, 'pointermove', 800);
    pointer(handle, 'pointerup', 800);
    expect(panel.dataset['snap']).toBe('peek');
    pointer(handle, 'pointerdown', 700);
    pointer(handle, 'pointermove', 420);
    pointer(handle, 'pointerup', 420);
    expect(panel.dataset['snap']).toBe('half');
    root.remove();
  });

  it('cancels a drag and ignores another pointer', () => {
    const { root, panel, handle } = setup();
    pointer(handle, 'pointerdown', 400);
    pointer(handle, 'pointermove', 10, 2);
    expect(panel.style.getPropertyValue('--sheet-drag-height')).toBe('');
    pointer(handle, 'pointermove', 10);
    pointer(handle, 'pointercancel', 10);
    expect(panel.dataset['snap']).toBe('half');
    expect(panel.style.getPropertyValue('--sheet-drag-height')).toBe('');
    handle.click();
    expect(panel.dataset['snap']).toBe('full');
    root.remove();
  });

  it('reveals focused content from peek and keeps fallback content intact', () => {
    const { root, panel, handle } = setup();
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'End' }));
    const content = root.querySelector<HTMLElement>('#content')!;
    const input = document.createElement('input'); content.append(input);
    input.focus(); expect(panel.dataset['snap']).toBe('half');
    handle.focus();
    setShellMapUnavailable(root);
    expect(root.classList.contains('is-map-first')).toBe(false);
    expect(root.querySelector('#content input')).toBe(input);
    expect(document.activeElement).not.toBe(handle);
    root.remove();
  });
});
