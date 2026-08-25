import { displayDate } from './place-labels';

/** Strings shown on every screen. PRD §21 requires both the source line and the disclaimer. */
export const SOURCE_LINE = '데이터 기준: 한국교원대학교 업무추진비 공개자료';

export const DISCLAIMER =
  '이용 횟수는 공개된 업무추진비 결제 내역을 기준으로 계산합니다. ' +
  '특정 장소에 대한 공식적인 추천이나 평가를 뜻하지 않습니다.';

export interface ShellOptions {
  /** `updatedAt` from data/places.json, once the dataset is wired in. */
  updatedAt?: string;
}

/**
 * Renders the persistent page frame: header, a slot for the feature views, and the
 * footer that carries the data provenance. Feature modules fill `#content`.
 */
export function renderShell(root: HTMLElement, options: ShellOptions = {}): void {
  const header = document.createElement('header');
  header.className = 'shell-header';

  const title = document.createElement('h1');
  title.textContent = 'KNUE PICK';
  const tagline = document.createElement('p');
  tagline.className = 'shell-tagline';
  tagline.textContent = '교직원이 자주 이용한 곳';
  header.append(title, tagline);

  const content = document.createElement('main');
  content.id = 'content';

  const footer = document.createElement('footer');
  footer.className = 'shell-footer';

  const source = document.createElement('p');
  source.textContent = SOURCE_LINE;
  footer.append(source);

  const disclaimer = document.createElement('p');
  disclaimer.className = 'shell-disclaimer';
  disclaimer.textContent = DISCLAIMER;
  footer.append(disclaimer);

  root.replaceChildren(header, content, footer);

  if (options.updatedAt) setShellUpdatedAt(root, options.updatedAt);
}

/**
 * Writes the provenance date into an already-rendered shell, creating the line on first call and
 * rewriting it after that.
 *
 * It exists so a dataset arriving after the frame is up does not cost a second `renderShell`:
 * rebuilding the frame detaches `#content`, and any element inside it that holds focus — the retry
 * button the user just pressed — goes with it, dropping focus to the top of the document.
 */
export function setShellUpdatedAt(root: HTMLElement, updatedAt: string): void {
  const footer = root.querySelector<HTMLElement>('.shell-footer');
  if (!footer) return;

  const text = `최근 데이터 업데이트: ${displayDate(updatedAt)}`;
  const existing = footer.querySelector<HTMLParagraphElement>('.shell-updated');
  if (existing) {
    existing.textContent = text;
    return;
  }

  const updated = document.createElement('p');
  updated.className = 'shell-updated';
  updated.textContent = text;
  // Before the disclaimer: PRD §21 keeps the denial last on the screen, and the source line first.
  footer.insertBefore(updated, footer.querySelector('.shell-disclaimer'));
}
