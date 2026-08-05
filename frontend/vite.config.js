import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: path.resolve(import.meta.dirname, '../public'),
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:9191',
      '/webhooks': 'http://localhost:9191',
    },
  },
});
