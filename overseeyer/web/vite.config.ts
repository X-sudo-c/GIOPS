import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.OVERSEYER_WEB_PORT) || 5191,
    proxy: {
      '/api': {
        target: process.env.VITE_OVERSEYER_API_URL || 'http://127.0.0.1:5190',
        changeOrigin: true,
      },
    },
  },
});
