import { describe, expect, it } from 'vitest';
import { DISCLAIMER } from './shell';

/**
 * `docs/conventions.md` → Framing Vocabulary, enforced across the whole repo.
 *
 * The per-module framing tests only guard the modules someone remembered to guard; this one reads
 * every shipped source, so a new file carrying banned copy fails without anyone having to add it
 * to a list.
 */

/**
 * Vite resolves these at transform time, so the scan needs no filesystem access and picks up a new
 * module the moment it lands. Test files are excluded: their banned-phrase lists are the rule, not
 * a violation of it.
 */
const SOURCES: Record<string, string> = {
  ...import.meta.glob(['/src/**/*.{ts,css}', '!/src/**/*.test.ts'], {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
  ...import.meta.glob('/index.html', { query: '?raw', import: 'default', eager: true }),
};

/**
 * The table's phrases plus the bare tokens they are built from — `평점` alone is already banned
 * framing, and banning the token is what stops a novel phrasing of the same idea.
 */
const BANNED = [
  '추천',
  '맛집',
  '베스트',
  '평점',
  '별점',
  '감시',
  '추적',
  '교원이 인정',
  '과다 사용',
  '순위가 높은',
];

/**
 * PRD §21 requires the disclaimer to deny that usage counts are a recommendation, so the one
 * sanctioned `추천` in the product is that denial. Exempt the exact sentence, nothing wider — a
 * bare `추천` literal elsewhere in the same file still fails.
 */
const SANCTIONED = [DISCLAIMER];

/**
 * Only string literals carry user-facing copy, so only they are scanned: an identifier named
 * `recommended` is not banned framing, and a rule quoted in a comment — as `rankDeltaLabel` does —
 * is documentation, not copy. A regex cannot make that split (`//` inside a URL literal is not a
 * comment), so this walks the source instead.
 *
 * Literals are joined without a separator so a value the source builds by concatenating fragments
 * — `DISCLAIMER` is written as two — is scanned, and exempted, as the one string it becomes.
 *
 * Known limit: regex literals are not recognised, so a quote character inside one (`/['"]/`) would
 * open a phantom string and shift what the walk reads as copy. No such literal exists in `src/`
 * today; a full parse is the fix if one ever lands.
 */
function stringLiterals(source: string): string {
  let out = '';
  let index = 0;

  while (index < source.length) {
    const char = source[index]!;
    const next = source[index + 1];

    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2);
      index = end === -1 ? source.length : end + 2;
      continue;
    }
    if (char !== "'" && char !== '"' && char !== '`') {
      index += 1;
      continue;
    }

    const quote = char;
    index += 1;
    while (index < source.length && source[index] !== quote) {
      // An escape consumes both characters; no escape sequence spells Korean copy.
      if (source[index] === '\\') {
        index += 2;
        continue;
      }
      out += source[index];
      index += 1;
    }
    index += 1;
  }

  return out;
}

/** Markup and stylesheets have no literals to isolate — their text is the copy, minus comments. */
function markupText(source: string, path: string): string {
  return path.endsWith('.html')
    ? source.replaceAll(/<!--[\s\S]*?-->/g, ' ')
    : source.replaceAll(/\/\*[\s\S]*?\*\//g, ' ');
}

function scannableText(path: string): string {
  const source = SOURCES[path] ?? '';
  const text = path.endsWith('.ts') ? stringLiterals(source) : markupText(source, path);

  return SANCTIONED.reduce((remaining, allowed) => remaining.replaceAll(allowed, ' '), text);
}

describe('framing vocabulary', () => {
  const files = Object.keys(SOURCES).sort();

  it('scans the shipped sources, so an unguarded new module cannot slip through', () => {
    // A file list that came up empty would make every assertion below vacuously pass.
    expect(files.length).toBeGreaterThan(10);
    expect(files).toContain('/index.html');
    expect(files).toContain('/src/styles.css');
    expect(files.filter((path) => path.endsWith('.test.ts'))).toEqual([]);
    expect(scannableText('/src/ui/shell.ts')).toContain('데이터 기준');
  });

  it.each(files)('%s carries no banned framing', (path) => {
    const text = scannableText(path);

    for (const phrase of BANNED) {
      expect(text, `${path} must not contain "${phrase}"`).not.toContain(phrase);
    }
  });

  it('reads copy out of a source file and flags the banned words in it', () => {
    // Guards the guard: were `stringLiterals` to swallow real copy, the scan above would go blind
    // while still passing, so assert the extraction on a source-shaped sample.
    const sample = "export const HEADING = '추천 맛집 TOP 10'; // 순위가 높은 좋은 집 is banned\n";

    const text = stringLiterals(sample);

    expect(text).toBe('추천 맛집 TOP 10');
    expect(BANNED.filter((phrase) => text.includes(phrase))).toEqual(['추천', '맛집']);
  });

  it('keeps a banned phrase visible when it sits after a URL on the same line', () => {
    const sample = "const url = 'https://map.naver.com/p/search/x'; const bad = '평점';";

    expect(stringLiterals(sample)).toContain('평점');
  });

  it('exempts the PRD §21 disclaimer without exempting a bare 추천 beside it', () => {
    const sample = `const a = ${JSON.stringify(DISCLAIMER)}; const b = '추천';`;

    const text = SANCTIONED.reduce(
      (remaining, allowed) => remaining.replaceAll(allowed, ' '),
      stringLiterals(sample),
    );

    expect(text).toContain('추천');
    // Derived from the constant, not retyped: a reworded disclaimer must not quietly turn this
    // assertion into one that passes because its literal is absent from the sample entirely.
    expect(stringLiterals(sample)).toContain(DISCLAIMER);
    expect(text).not.toContain(DISCLAIMER);
  });
});
