import { defineConfig } from 'vitest/config';

// GitHub Pages serves this repo from https://kadragon.github.io/knue-pic/,
// so every built asset URL needs the repo subpath prefix.
export default defineConfig({
  base: '/knue-pic/',
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
