import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { copyFileSync, mkdirSync, readdirSync } from 'fs'

// Plugin to copy templates to dist
function copyTemplatesPlugin() {
  return {
    name: 'copy-templates',
    closeBundle() {
      const srcDir = resolve(__dirname, 'src/main/resources/templates')
      const destDir = resolve(__dirname, 'dist/main/resources/templates')
      
      try {
        mkdirSync(destDir, { recursive: true })
        const files = readdirSync(srcDir)
        for (const file of files) {
          if (file.endsWith('.hbs')) {
            copyFileSync(resolve(srcDir, file), resolve(destDir, file))
          }
        }
        console.log('✓ Templates copied to dist/main/resources/templates')
      } catch (error) {
        console.error('Failed to copy templates:', error)
      }
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['electron-core-ui'] }), copyTemplatesPlugin()],
    resolve: {
      alias: {
        // In dev & build, use core-ui main sources directly
        'electron-core-ui/main': resolve(__dirname, '../electron-core-ui/src/main/index.ts'),
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
