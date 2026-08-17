/** Strings shown on every screen. PRD §21 requires both the source line and the disclaimer. */
export const SOURCE_LINE = '데이터 기준: 한국교원대학교 업무추진비 공개자료';

export const DISCLAIMER =
  '이용횟수는 공개된 업무추진비 결제내역을 기준으로 산정합니다. ' +
  '이용횟수가 해당 업체에 대한 공식적인 추천이나 평가를 의미하지 않습니다.';

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

  if (options.updatedAt) {
    const updated = document.createElement('p');
    updated.textContent = `최근 데이터 업데이트: ${options.updatedAt}`;
    footer.append(updated);
  }

  const disclaimer = document.createElement('p');
  disclaimer.className = 'shell-disclaimer';
  disclaimer.textContent = DISCLAIMER;
  footer.append(disclaimer);

  root.replaceChildren(header, content, footer);
}
