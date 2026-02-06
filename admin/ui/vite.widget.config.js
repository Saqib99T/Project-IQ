import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
    plugins: [react()],
    define: {
        'process.env.NODE_ENV': '"production"'
    },
    build: {
        outDir: 'dist-widget',
        emptyOutDir: true,
        lib: {
            entry: resolve(__dirname, 'src/widget.jsx'),
            name: 'GlpiChatWidget',
            fileName: (format) => `glpi-chat-widget.js`,
            formats: ['iife']
        },
        minify: false,
        rollupOptions: {
            output: {
                banner: `
if (typeof window !== 'undefined' && !window.process) {
    window.process = { env: { NODE_ENV: 'production' } };
}
                `
            }
        }
    }
})
