import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'fs'
import { createInstrumenter } from 'istanbul-lib-instrument'

// Plugin to copy templates to dist (recursively, preserving subdirectories)
function copyTemplatesPlugin() {
  function copyHbsRecursive(srcDir: string, destDir: string): void {
    mkdirSync(destDir, { recursive: true })
    for (const entry of readdirSync(srcDir)) {
      const srcPath = resolve(srcDir, entry)
      const destPath = resolve(destDir, entry)
      if (statSync(srcPath).isDirectory()) {
        copyHbsRecursive(srcPath, destPath)
      } else if (entry.endsWith('.hbs')) {
        copyFileSync(srcPath, destPath)
      }
    }
  }

  return {
    name: 'copy-templates',
    closeBundle() {
      const srcDir = resolve(__dirname, 'src/main/resources/templates')
      const destDir = resolve(__dirname, 'dist/main/resources/templates')

      try {
        copyHbsRecursive(srcDir, destDir)
        console.log('✓ Templates copied to dist/main/resources/templates')
      } catch (error) {
        console.error('Failed to copy templates:', error)
      }
    }
  }
}

function rendererCoverageInstrumentationPlugin() {
  const instrumenter = createInstrumenter({
    esModules: true,
    produceSourceMap: true
  })

  return {
    name: 'restorm-renderer-coverage-instrumentation',
    enforce: 'post',
    transform(this: unknown, code: string, id: string) {
      if (process.env.VITE_COVERAGE !== 'true') return null
      if (!id.includes('/src/renderer/src/')) return null
      if (!/\.(ts|tsx|js|jsx)$/.test(id)) return null
      if (id.includes('/node_modules/')) return null

      const ctx = this as { getCombinedSourcemap?: () => unknown }
      const inputSourceMap = typeof ctx.getCombinedSourcemap === 'function' ? ctx.getCombinedSourcemap() : undefined

      const instrumented = instrumenter.instrumentSync(code, id, inputSourceMap as never)
      const map = instrumenter.lastSourceMap()

      return { code: instrumented, map }
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['electron-core-ui'] }), copyTemplatesPlugin()],
    resolve: {
      alias: {
        // In dev & build, use core-ui main sources directly.
        // Exact-match paths (longest first) so `electron-core-ui/decorators`
        // resolves to its dedicated entry instead of being caught by the
        // bare `electron-core-ui` prefix alias.
        'electron-core-ui/decorators': resolve(__dirname, '../electron-core-ui/src/main/decorators/index.ts'),
        'electron-core-ui/main': resolve(__dirname, '../electron-core-ui/src/main/index.ts'),
        'electron-core-ui': resolve(__dirname, '../electron-core-ui/src/main/index.ts')
      }
    },
    build: {
      outDir: 'dist/main',
      sourcemap: process.env.VITE_COVERAGE === 'true',
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
      sourcemap: process.env.VITE_COVERAGE === 'true',
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
      sourcemap: process.env.VITE_COVERAGE === 'true',
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
        // Pointer vers les sources de core-ui pour le HMR. On alias
        // explicitement `electron-core-ui/decorators` pour que les modèles
        // partagés tirent uniquement les décorateurs (sans dépendre du
        // grand barrel `electron-core-ui/main` qui contient des services
        // node-only).
        'electron-core-ui/decorators': resolve(__dirname, '../electron-core-ui/src/main/decorators/index.ts'),
        'electron-core-ui/renderer': resolve(__dirname, '../electron-core-ui/src/renderer/index.ts')
      }
    },
    plugins: [react(), rendererCoverageInstrumentationPlugin()],
    optimizeDeps: {
      // Ne pas optimiser electron-core-ui
      exclude: ['electron-core-ui']
    },
    publicDir: resolve(__dirname, 'assets'),
    // Define env variables for test helpers
    define: {
      'import.meta.env.VITE_ENABLE_TEST_HELPERS': JSON.stringify(process.env.VITE_ENABLE_TEST_HELPERS ?? 'false'),
      // Suppress Vue feature flag warnings from milkdown (which uses Vue internally)
      '__VUE_OPTIONS_API__': JSON.stringify(false),
      '__VUE_PROD_DEVTOOLS__': JSON.stringify(false),
      '__VUE_PROD_HYDRATION_MISMATCH_DETAILS__': JSON.stringify(false)
    }
  }
})
