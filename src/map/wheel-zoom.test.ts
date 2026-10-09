import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindWheelZoom } from './wheel-zoom';

describe('map wheel zoom', () => {
  let canvas: HTMLElement;
  let zoom: ReturnType<typeof vi.fn<(delta: number, x: number, y: number) => void>>;
  let release: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    canvas = document.createElement('div');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 50, height: 600 } as DOMRect);
    zoom = vi.fn();
    release = bindWheelZoom(canvas, zoom);
  });
  afterEach(() => { release(); vi.useRealTimers(); });

  function wheel(deltaY: number, extra: WheelEventInit = {}): WheelEvent {
    const event = new WheelEvent('wheel', { deltaY, clientX: 180, clientY: 120, cancelable: true, ...extra });
    canvas.dispatchEvent(event);
    return event;
  }

  it('zooms one level at the pointer and consumes vertical wheel', () => {
    expect(wheel(-120).defaultPrevented).toBe(true);
    expect(zoom).toHaveBeenLastCalledWith(1, 80, 70);
    vi.advanceTimersByTime(250);
    wheel(1200);
    expect(zoom).toHaveBeenLastCalledWith(-1, 80, 70);
  });

  it('accumulates small pixel deltas instead of zooming for every event', () => {
    for (let i = 0; i < 7; i++) wheel(-5);
    expect(zoom).not.toHaveBeenCalled();
    wheel(-5);
    expect(zoom).toHaveBeenCalledTimes(1);
  });

  it.each([1, 2])('normalizes deltaMode %s', (deltaMode) => {
    wheel(-3, { deltaMode });
    expect(zoom).toHaveBeenCalledWith(1, 80, 70);
  });

  it('bounds a burst and never queues inertial input', () => {
    wheel(-100);
    for (let i = 0; i < 20; i++) { vi.advanceTimersByTime(5); wheel(-100); }
    expect(zoom).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(zoom).toHaveBeenCalledTimes(1);
    wheel(-100);
    expect(zoom).toHaveBeenCalledTimes(2);
  });

  it('clears accumulated input on reversal and after a pause', () => {
    wheel(-30); wheel(20);
    expect(zoom).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    wheel(20);
    expect(zoom).not.toHaveBeenCalled();
    wheel(20);
    expect(zoom).toHaveBeenCalledWith(-1, 80, 70);
  });

  it('leaves horizontal/modified scrolling and browser zoom alone', () => {
    for (const extra of [{ deltaX: 100 }, { shiftKey: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      expect(wheel(10, extra).defaultPrevented).toBe(false);
    }
    expect(wheel(0).defaultPrevented).toBe(false);
    expect(zoom).not.toHaveBeenCalled();
  });

  it('removes the wheel listener on release', () => {
    release();
    expect(wheel(-100).defaultPrevented).toBe(false);
    expect(zoom).not.toHaveBeenCalled();
  });
});
