import { describe, expect, it } from 'vitest';
import { DISCLAIMER, SOURCE_LINE, renderShell } from './shell';

describe('renderShell', () => {
  it('always shows the data source line and the usage disclaimer', () => {
    const root = document.createElement('div');

    renderShell(root);

    expect(root.textContent).toContain(SOURCE_LINE);
    expect(root.textContent).toContain(DISCLAIMER);
  });

  it('shows the update date only when the dataset provides one', () => {
    const withDate = document.createElement('div');
    renderShell(withDate, { updatedAt: '2026-08-01' });
    expect(withDate.textContent).toContain('최근 데이터 업데이트: 2026-08-01');

    const withoutDate = document.createElement('div');
    renderShell(withoutDate);
    expect(withoutDate.textContent).not.toContain('최근 데이터 업데이트');
  });

  it('leaves an empty content slot for feature views', () => {
    const root = document.createElement('div');

    renderShell(root);

    const content = root.querySelector('#content');
    expect(content).not.toBeNull();
    expect(content?.childElementCount).toBe(0);
  });
});
