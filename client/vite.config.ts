import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
  },
  server: {
    proxy: {
      '/ws': {
        target: 'ws://server:3000',
        ws: true,
      },
    },
  },
});
