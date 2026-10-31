import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    // No sourcemaps in production: they can embed local absolute paths.
    sourcemap: false,
  },
});
