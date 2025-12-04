import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['electron-core-ui'] })],
    resolve: {
      alias: {
        // In dev & build, use core-ui main sources directly
        'electron-core-ui': resolve(__dirname, '../electron-core-ui/src/main/index.ts')
      }
    },
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
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/preload/index.ts')
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
          index: resolve(__dirname, 'src/renderer/index.html'),
          editor: resolve(__dirname, 'src/renderer/editor.html')
        }
      }
    },
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src'),
        // Pointer vers les sources de core-ui pour le HMR
        'electron-core-ui/renderer': resolve(__dirname, '../electron-core-ui/src/renderer/index.ts')
      }
    },
    plugins: [react()],
    optimizeDeps: {
      // Ne pas optimiser electron-core-ui
      exclude: ['electron-core-ui']
    },
    publicDir: resolve(__dirname, 'assets')
  }
})

