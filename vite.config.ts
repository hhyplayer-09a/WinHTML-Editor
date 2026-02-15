import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['pdfjs-dist']
  },
  server: {
    port: 3000,      // Fix the port to 3000
    strictPort: true, // If 3000 is occupied, fail instead of trying the next available port
    host: true,       // Listen on all local IPs
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:58888',
        changeOrigin: true,
        secure: false
      }
    }
  }
})