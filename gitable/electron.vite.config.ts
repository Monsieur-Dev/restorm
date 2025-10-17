import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist/main',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist/preload',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      outDir: 'dist/renderer',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html')
        }
      }
    },
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src'),
        // Pointer vers les sources de core-ui pour le HMR
        'electron-vscodelike-core-ui/renderer': resolve(__dirname, '../electron-vscodelike-core-ui/src/renderer/index.ts'),
        'electron-vscodelike-core-ui/fonts.css': resolve(__dirname, '../electron-vscodelike-core-ui/fonts.css')
      }
    },
    plugins: [react()],
    optimizeDeps: {
      // Ne pas optimiser electron-vscodelike-core-ui
      exclude: ['electron-vscodelike-core-ui']
    }
  }
})

