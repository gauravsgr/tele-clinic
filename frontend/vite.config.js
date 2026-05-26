/**
 * vite.config.js — Vite build + dev-server + test configuration.
 *
 * Proxy rationale:
 *   The React SPA calls /api/* paths so that all requests originate from the
 *   same origin as the page (avoiding CORS preflight in dev). Vite strips the
 *   "/api" prefix before forwarding to FastAPI on port 8000 — so the backend
 *   sees clean paths like GET /slots, POST /book, etc.
 *
 *   In production, the same rewrite rule is configured in the reverse proxy
 *   (Nginx / Caddy) that sits in front of both services.
 *
 * Vitest is co-located here (no separate vitest.config.js) to keep a single
 * source of truth for the test environment. jsdom simulates browser APIs;
 * globals: true makes describe/it/expect available without imports in test
 * files (mirrors Jest's default behaviour).
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],

  server: {
    proxy: {
      // All /api/* requests → http://localhost:8000/*
      // The rewrite removes the /api prefix so FastAPI never sees it.
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },

  test: {
    // jsdom gives us window, document, localStorage, etc. without a browser.
    environment: 'jsdom',
    // setupTests.js imports @testing-library/jest-dom matchers (toBeInTheDocument, etc.)
    setupFiles: ['./src/setupTests.js'],
    // Expose Vitest globals so test files don't need to import describe/it/expect.
    globals: true,
  },
});
