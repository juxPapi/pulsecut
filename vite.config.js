import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5190,
    strictPort: true,
    // Render jobs write transient files (font, captions, videos) into data/.
    // Downloaded clips live in inspection/. Watching either directory makes
    // Vite crash with EBUSY while files are being written or remuxed.
    watch: {
      ignored: [/node_modules/, /\.git/, /[\\/]data[\\/]/, /[\\/]inspection[\\/]/],
    },
    proxy: {
      '/api': 'http://127.0.0.1:8790',
      '/media': 'http://127.0.0.1:8790',
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
