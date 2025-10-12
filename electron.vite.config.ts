import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { copyFileSync, mkdirSync, existsSync } from 'fs'

// Plugin pour copier les ressources
function copyResourcesPlugin() {
  return {
    name: 'copy-resources',
    closeBundle() {
      const srcPath = resolve(__dirname, 'src/resources/settings-schema.json')
      const destDir = resolve(__dirname, 'dist/resources')
      const destPath = resolve(destDir, 'settings-schema.json')
      
      if (!existsSync(destDir)) {
        mkdirSync(destDir, { recursive: true })
      }
      copyFileSync(srcPath, destPath)
      console.log('✓ Copied settings-schema.json to dist/resources/')
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), copyResourcesPlugin()],
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
        '@renderer': resolve(__dirname, 'src/renderer/src')
      }
    },
    plugins: [react()]
  }
})

