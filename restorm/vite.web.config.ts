import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
  },
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      // Point to electron-core-ui sources for web mode (tests E2E)
      'electron-core-ui/renderer': resolve(__dirname, '../electron-core-ui/src/renderer/index.ts')
    }
  },
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  }
})
