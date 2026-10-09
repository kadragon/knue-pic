export function bindWheelZoom(
  canvas: HTMLElement,
  zoom: (delta: number, x: number, y: number) => void,
): () => void {
  // Pixel deltas from trackpads accumulate; a mouse notch still makes only one step.
  const threshold = 40;
  const cooldown = 250;
  let accumulated = 0;
  let lastInput = -Infinity;
  let lastZoom = -Infinity;

  const onWheel = (event: WheelEvent): void => {
    if (
      event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey ||
      !Number.isFinite(event.deltaY) || event.deltaY === 0 ||
      Math.abs(event.deltaX) > Math.abs(event.deltaY)
    ) return;

    event.preventDefault();
    const now = performance.now();
    const rect = canvas.getBoundingClientRect();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
    const delta = event.deltaY * unit;
    if (now - lastInput > 150 || Math.sign(delta) !== Math.sign(accumulated)) accumulated = 0;
    lastInput = now;
    // Drop input during the animation instead of replaying a backlog after the gesture ends.
    if (now - lastZoom < cooldown) return;
    accumulated += delta;
    if (Math.abs(accumulated) < threshold) return;
    accumulated = 0;
    lastZoom = now;
    zoom(delta < 0 ? 1 : -1, event.clientX - rect.left, event.clientY - rect.top);
  };
  canvas.addEventListener('wheel', onWheel, { passive: false });
  return () => canvas.removeEventListener('wheel', onWheel);
}
