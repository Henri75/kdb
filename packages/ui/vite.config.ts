import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8710',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      /**
       * jsPDF lists html2canvas, canvg and dompurify as *optional* deps: it
       * imports them lazily inside `doc.html()` and its SVG path. We use neither
       * — the PDF is drawn from the answer's markdown and source list with the
       * text API, which is exactly what keeps the output selectable rather than
       * a screenshot. Rollup cannot prove those branches are dead, so without
       * this it bundles ~350 KB of renderers that can never execute.
       */
      external: ['html2canvas', 'canvg', 'dompurify/dist/purify.es.mjs'],
    },
  },
});
