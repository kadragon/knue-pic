import { defineConfig } from 'vitest/config';

// GitHub Pages serves this repo from https://kadragon.github.io/knue-pic/,
// so every built asset URL needs the repo subpath prefix.
export default defineConfig({
  base: '/knue-pic/',
  // `data/places.json` is the published dataset and the app's only data source. Vite copies
  // `publicDir` verbatim into `dist/`, so pointing it at `data/` is what puts the file on the
  // deployed site — the default `public/` would leave it out. Repo path stays `data/places.json`
  // (every doc and the collector assume it); the browser URL becomes `${BASE_URL}places.json`.
  publicDir: 'data',
  // The Naver browser key accepts http://localhost:5173 and rejected :5179 and :4173 with a 401
  // (observed 2026-10-03). Vite's default is to slide to the next free port, which serves a page
  // whose map silently falls back — so hold 5173 or fail. `docs/runbook.md` → Naver API Keys.
  // `preview` gets the same pin: its default :4173 is rejected too, which left no local origin to
  // check a production bundle against the real map. The two servers cannot run at once.
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
  test: {
    environment: 'jsdom',
    // Load-bearing for two guards, not a rendering nicety: Vitest stubs CSS modules to an empty
    // string by default, which silently blinded the framing scan's `/src/styles.css` entry and
    // would do the same to the rank-colour assertions in `src/ui/top-places.test.ts`. Both read
    // the stylesheet as text, and both pass vacuously over ''.
    css: true,
    include: ['src/**/*.test.ts'],
  },
});
