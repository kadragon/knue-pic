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
 * Renders the persistent page frame: header, the provenance band, and a slot for the feature
 * views. Feature modules fill `#content`.
 *
 * The provenance sits *above* `#content` rather than after it. The ranked list runs to hundreds of
 * rows, so at the bottom of the document it is reached only by scrolling past all of them, and a
 * line nobody scrolls to does not carry PRD §21. Above the list it is on the first screen instead
 * — not on every screen, which only a sticky element would be, and holding the top of the viewport
 * for the whole session is exactly what this band must not do. It says where the list came from
 * once, on arrival.
 *
 * Still a `<footer>` element, moved rather than replaced: it is the page's only `contentinfo`
 * landmark, and a `<section>` with no accessible name exposes none, which would cost a screen
 * reader user the one jump target that reaches the source line and the disclaimer. The landmark is
 * about what the content *is*, not where it sits in the flow.
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

  const provenance = document.createElement('footer');
  provenance.className = 'shell-provenance';

  const source = document.createElement('p');
  source.textContent = SOURCE_LINE;
  provenance.append(source);

  const disclaimer = document.createElement('p');
  disclaimer.className = 'shell-disclaimer';
  disclaimer.textContent = DISCLAIMER;
  provenance.append(disclaimer);

  const content = document.createElement('main');
  content.id = 'content';

  root.replaceChildren(header, provenance, content);

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
  const provenance = root.querySelector<HTMLElement>('.shell-provenance');
  if (!provenance) return;

  const text = `최근 데이터 업데이트: ${displayDate(updatedAt)}`;
  const existing = provenance.querySelector<HTMLParagraphElement>('.shell-updated');
  if (existing) {
    existing.textContent = text;
    return;
  }

  const updated = document.createElement('p');
  updated.className = 'shell-updated';
  updated.textContent = text;
  // Before the disclaimer: PRD §21 keeps the denial last in the band, and the source line first.
  provenance.insertBefore(updated, provenance.querySelector('.shell-disclaimer'));
}
