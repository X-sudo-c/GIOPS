import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/v1': {
        target: process.env.VITE_SYNC_SERVICE_URL || 'http://localhost:5000',
        changeOrigin: true,
        secure: false,
      },
      '/ocr-api': {
        target: process.env.VITE_OCR_SERVICE_URL || 'http://localhost:5002',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/ocr-api/, ''),
      },
      '/martin': {
        target: process.env.VITE_MARTIN_PROXY_TARGET || 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/martin/, ''),
      },
    },
  },
})
