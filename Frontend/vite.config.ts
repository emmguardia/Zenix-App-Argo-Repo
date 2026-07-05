import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // En dev : même origine → cookies de session sans friction CORS
      '/api': { target: 'http://localhost:3000', changeOrigin: false },
    },
  },
  build: {
    sourcemap: false,
  },
});
