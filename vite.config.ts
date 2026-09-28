import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // hls.js (~590 kB) is lazy-loaded only for .m3u8 streams.
  build: { chunkSizeWarningLimit: 700 },
  server: {
    port: 5173,
    // The Node server holds the Trakt client secret; the browser only talks to /api.
    proxy: { '/api': 'http://localhost:8787' },
  },
});
