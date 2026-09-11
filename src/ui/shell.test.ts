import { describe, expect, it } from 'vitest';
import { DISCLAIMER, SOURCE_LINE, renderShell, setShellUpdatedAt } from './shell';

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
    expect(provenance?.textContent).toContain('최근 데이터 업데이트: 2026년 8월 1일');
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
    // lines, and the band order source → updated → disclaimer has to survive the rewrite.
    expect(root.querySelector('.shell-updated')).toBe(line);
    expect(root.querySelectorAll('.shell-updated')).toHaveLength(1);
    expect(root.textContent).toContain('최근 데이터 업데이트: 2026년 8월 1일');
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
