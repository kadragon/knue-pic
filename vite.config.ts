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
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
