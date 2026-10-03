import type { WindowSummary } from '../stats/window-summary';
import { displayDate } from './place-labels';

/**
 * The one-line answer above the filters: as of when, how many places, how many visits, under the
 * period and 업종 the reader selected. Every number arrives computed (`src/stats/window-summary.ts`);
 * this module only words it. 곳 and 회 are the units the list rows already print, and nothing here
 * ranks or judges — `docs/conventions.md` → Framing Vocabulary.
 */
export function summaryLabel(updatedAt: string, summary: WindowSummary): string {
  return `${displayDate(updatedAt)} 기준 · ${summary.placeCount}곳 · ${summary.visitCount}회`;
}

/**
 * Creates the line on first call and rewrites its text after that, so a filter change never
 * replaces the node. No live region: the list's own counter already announces the change, and a
 * second polite region firing on the same press would read the news twice.
 */
export function renderSummaryLine(container: HTMLElement, text: string): void {
  const existing = container.querySelector<HTMLParagraphElement>('.summary-line');
  if (existing) {
    existing.textContent = text;
    return;
  }
  const line = document.createElement('p');
  line.className = 'summary-line';
  line.textContent = text;
  container.replaceChildren(line);
}
