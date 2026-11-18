/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/** GitHub Pages cannot set response headers, so the security policy ships inside the page. */
function contentSecurityPolicy(): Plugin {
  const policy = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' data: blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ');
  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml: (html) => html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`),
  };
}

export default defineConfig({
  // Relative paths keep the site working under any repository name.
  base: './',
  plugins: [react(), contentSecurityPolicy()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('echarts') || id.includes('zrender')) return 'charts';
          if (id.includes('node_modules/react') || id.includes('scheduler')) return 'react';
        },
      },
    },
  },
  test: { include: ['tests/**/*.test.ts'], environment: 'node', testTimeout: 60000 },
});
