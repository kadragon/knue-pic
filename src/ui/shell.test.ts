import { describe, expect, it } from 'vitest';
import { DISCLAIMER, SOURCE_LINE, renderShell, setShellUpdatedAt } from './shell';

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
    expect(withDate.textContent).toContain('최근 데이터 업데이트: 2026년 8월 1일');

    const withoutDate = document.createElement('div');
    renderShell(withoutDate);
    expect(withoutDate.textContent).not.toContain('최근 데이터 업데이트');
  });

  it('rewrites the update date in place instead of adding a second line', () => {
    const root = document.createElement('div');
    renderShell(root, { updatedAt: '2026-07-01' });
    const line = root.querySelector('.shell-updated');

    setShellUpdatedAt(root, '2026-08-01');

    // Same node, new text: a dataset arriving after the frame is up must not stack provenance
    // lines, and the footer order source → updated → disclaimer has to survive the rewrite.
    expect(root.querySelector('.shell-updated')).toBe(line);
    expect(root.querySelectorAll('.shell-updated')).toHaveLength(1);
    expect(root.textContent).toContain('최근 데이터 업데이트: 2026년 8월 1일');
    expect(root.textContent).not.toContain('2026년 7월 1일');
    const footerText = [...root.querySelectorAll('.shell-footer p')].map((p) => p.className);
    expect(footerText[footerText.length - 1]).toBe('shell-disclaimer');
  });

  it('leaves an empty content slot for feature views', () => {
    const root = document.createElement('div');

    renderShell(root);

    const content = root.querySelector('#content');
    expect(content).not.toBeNull();
    expect(content?.childElementCount).toBe(0);
  });
});
