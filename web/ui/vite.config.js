import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Don't copy public/ into dev server output — admin/operator files are served
  // directly by Flask from public/ in production, and by the fallback in dev.
  publicDir: 'public/widget',
  build: {
    outDir: 'dist-widget',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
    },
  },
  server: {
    port: 3000,
  },
})
