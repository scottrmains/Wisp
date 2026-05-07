import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// Build outputs straight into Wisp.Api/wwwroot so Kestrel serves it in Release.
const apiWwwRoot = path.resolve(__dirname, '../Wisp.Api/wwwroot')

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:5125',
    },
  },
  build: {
    outDir: apiWwwRoot,
    emptyOutDir: true,
  },
})
