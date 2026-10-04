import { MAP_ERROR_MESSAGE } from '../map/place-map';
import { createBottomSheet } from './bottom-sheet';
import { displayDate } from './place-labels';

/** Strings shown on every screen. PRD §21 requires both the source line and the disclaimer. */
export const SOURCE_LINE = '데이터 기준: 한국교원대학교 업무추진비 공개자료';

export const DISCLAIMER =
  '이용 횟수는 공개된 업무추진비 결제 내역을 기준으로 계산합니다. ' +
  '특정 장소에 대한 공식적인 추천이나 평가를 뜻하지 않습니다.';

export const BRAND = 'KNUE PICK';

/**
 * The page's one heading, phrased as the reader's own question. It names no place as good and
 * frames nothing as oversight — `docs/conventions.md` → Framing Vocabulary — and the provenance
 * band directly under it says what the answer is counted from.
 */
export const HEADLINE = '요즘 동료들은 어디를 자주 갈까';

/** The control that takes the map back to the campus after a reader pans away from it. */
export const RECENTRE_LABEL = '학교로';

/** Marks the root as showing the map-first layout; `src/styles.css` reads it at every width. */
const MAP_FIRST_CLASS = 'is-map-first';

export interface ShellOptions {
  /** `updatedAt` from data/places.json, once the dataset is wired in. */
  updatedAt?: string;
  /**
   * Whether this viewport gets the map-first layout. The caller decides, because the same answer
   * decides whether the map script is loaded at all — and the layout must never claim a map the
   * page is not going to mount.
   */
  mapFirst?: boolean;
  /**
   * Pressed by `학교로`. The shell holds no map, so it hands the press on; without a callback no
   * control is rendered, because a button that does nothing is a tab stop onto a dead end.
   */
  onRecentre?: () => void;
}

/**
 * Renders the persistent page frame: header, the provenance band, a slot for the feature views and
 * the map region. Feature modules fill `#content`.
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
 *
 * The map region comes last in source order and holds nothing but the `학교로` control and whatever
 * the map mounts into it. Last so that a keyboard walk meets the page's own content before a
 * control over a picture; the stylesheet places it behind the desktop panel or mobile sheet.
 */
export function renderShell(root: HTMLElement, options: ShellOptions = {}): void {
  const header = document.createElement('header');
  header.className = 'shell-header';

  // The wordmark is small print and the question is the heading: a reader arrives with the
  // question, not with the product name, so the `h1` states what the page answers.
  const brand = document.createElement('p');
  brand.className = 'shell-brand';
  brand.textContent = BRAND;
  const title = document.createElement('h1');
  title.className = 'shell-headline';
  title.textContent = HEADLINE;
  header.append(brand, title);

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

  const panel = document.createElement('div');
  panel.className = 'sheet-panel';
  const scroll = document.createElement('div');
  scroll.className = 'sheet-scroll';
  scroll.append(header, provenance, content);
  panel.append(createBottomSheet(panel, scroll), scroll);
  root.replaceChildren(panel, mapRegion(options.onRecentre));

  if (options.mapFirst === true) root.classList.add(MAP_FIRST_CLASS);

  if (options.updatedAt) setShellUpdatedAt(root, options.updatedAt);
}

/**
 * The region the page map mounts into, with the control that recentres it.
 *
 * A `<section>` with no accessible name, deliberately: it is a picture and a button, not a document
 * region, and naming it would put a landmark in the tab order that reaches nothing a reader came
 * for. The button is inside it so removing an unavailable map also removes its control.
 */
function mapRegion(onRecentre?: () => void): HTMLElement {
  const region = document.createElement('div');
  region.className = 'map-shell-map';

  if (onRecentre) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'map-recentre';
    button.textContent = RECENTRE_LABEL;
    button.addEventListener('click', () => {
      onRecentre();
    });
    region.append(button);
  }

  return region;
}

/**
 * How much of the map, per edge, the page has drawn over right now — what the map frames around.
 *
 * Measured from the laid-out boxes rather than restated from the stylesheet, so a token change or a
 * dynamic-viewport unit cannot drift from it. Two layouts, told apart by where the panel starts: a
 * mobile sheet starts below the top of the map and covers its bottom (plus the provenance card a
 * collapsed sheet floats above it); the desktop panel starts at the top, and its masthead and
 * provenance cover a band across the top while `#content` covers a column down the left. Each edge
 * is clamped to the map, so a masthead the reader has scrolled away covers nothing.
 */
export function mapCoveredInsets(root: HTMLElement): {
  top: number;
  right: number;
  bottom: number;
  left: number;
} {
  const region = root.querySelector('.map-shell-map');
  const panel = root.querySelector('.sheet-panel');
  if (!region || !panel) return { top: 0, right: 0, bottom: 0, left: 0 };

  const map = region.getBoundingClientRect();
  const sheet = panel.getBoundingClientRect();
  const provenanceNode = root.querySelector('.shell-provenance');
  const provenance = provenanceNode?.getBoundingClientRect();
  const clampTo = (value: number, limit: number): number => Math.max(0, Math.min(limit, value));

  if (sheet.top > map.top) {
    // Only a card the stylesheet lifted out of the sheet covers the map. Its box alone cannot say
    // so: inside a scrolled sheet the card's box also sits above the sheet's top, clipped unseen.
    const lifted = provenanceNode && getComputedStyle(provenanceNode).position === 'fixed';
    const floating = lifted && provenance ? provenance.bottom : map.top;
    return {
      top: clampTo(floating - map.top, map.height),
      right: 0,
      bottom: clampTo(map.bottom - sheet.top, map.height),
      left: 0,
    };
  }
  const column = root.querySelector('#content')?.getBoundingClientRect();
  return {
    top: clampTo((provenance?.bottom ?? map.top) - map.top, map.height),
    right: 0,
    bottom: 0,
    left: clampTo((column?.right ?? map.left) - map.left, map.width),
  };
}

/**
 * Flips the map-first layout on or off without rebuilding the frame.
 *
 * Separate from `renderShell` because the frame may not be rebuilt: `#content` is inside it, and
 * replacing the frame detaches whatever inside it holds focus — the same reason
 * `setShellUpdatedAt` writes in place instead of re-rendering.
 */
export function setShellMapFirst(root: HTMLElement, on: boolean): void {
  root.classList.toggle(MAP_FIRST_CLASS, on);
}

/**
 * The map is not coming: give the content the whole width back and say so once.
 *
 * One entry point for both failure routes — the script never loading and the key rejecting the
 * origin — because they are the same state to the reader, and two sentences would be two answers.
 * The region's own canvas is removed with the region, and the map is released by the caller that
 * mounted it; what is left is today's page plus one line at the top of it.
 *
 * Keyed on the region still being there rather than on the layout class, because a failure that
 * lands after the reader has narrowed the window is still a failure: gating on the class dropped it,
 * and the window then widened to a panel with no map and no line saying why. The caller decides
 * *whether* a map was ever asked for — every viewport now requests the page map.
 */
export function setShellMapUnavailable(root: HTMLElement): void {
  const region = root.querySelector('.map-shell-map');
  const content = root.querySelector('#content');
  // No region: already fallen back, and this is the second failure of one mount.
  if (!region || !content) return;

  root.classList.remove(MAP_FIRST_CLASS);
  if (document.activeElement === root.querySelector('.sheet-handle') ||
    region.contains(document.activeElement)) {
    (content as HTMLElement).tabIndex = -1;
    (content as HTMLElement).focus();
  }
  region.remove();

  const note = document.createElement('p');
  note.className = 'shell-map-note';
  note.setAttribute('role', 'status');
  note.textContent = MAP_ERROR_MESSAGE;
  content.prepend(note);
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

  const text = `데이터 기준일: ${displayDate(updatedAt)}`;
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
