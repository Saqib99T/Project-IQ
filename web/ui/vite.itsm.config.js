import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
    plugins: [react()],
    base: '/itsm/',
    publicDir: false,
    build: {
        outDir: 'public/itsm',
        emptyOutDir: true,
        rollupOptions: {
            input: {
                itsm: resolve(__dirname, 'itsm.html'),
            },
        },
    },
})
