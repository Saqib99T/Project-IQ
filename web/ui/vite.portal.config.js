import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
    plugins: [react()],
    base: '/portal/',
    publicDir: false,
    build: {
        outDir: 'public/portal',
        emptyOutDir: true,
        rollupOptions: {
            input: {
                portal: resolve(__dirname, 'portal.html'),
            },
        },
    },
})
