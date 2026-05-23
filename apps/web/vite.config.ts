import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    commonjsOptions: {
      // shared-types se emite como CJS para que Nest lo consuma sin fricción.
      // Por defecto el plugin commonjs de Vite ignora workspace deps; lo forzamos
      // a procesarlo para que SCAN_NAMESPACE y otros runtime exports sean visibles.
      include: [/shared-types/, /node_modules/],
      transformMixedEsModules: true,
    },
  },
  optimizeDeps: {
    include: ['@short-scanner/shared-types'],
  },
});
