import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync } from 'fs'
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

/**
 * Is a crash-report source-map upload configured for this build?
 *
 * The upload is what makes source maps worth generating. They are stripped from
 * the shipped package unconditionally (a negated glob in package.json's
 * `build.files`), so a map that is not uploaded is a file nobody can ever read:
 * not in the package, not on the symbol server, pure build cost.
 *
 * Reads the same variables the Sentry tooling reads, so there is no separate
 * switch to forget: set the release pipeline's credentials and maps start being
 * produced and uploaded together.
 */
const sentryUploadConfigured =
  (process.env.SENTRY_AUTH_TOKEN ?? '') !== '' &&
  (process.env.SENTRY_ORG ?? '') !== '' &&
  (process.env.SENTRY_PROJECT ?? '') !== ''

/**
 * Source-map emission, for every bundle.
 *
 * Deliberately NOT unconditional. Generating maps for the renderer costs more
 * heap than an ordinary build has: the coverage script next door already has to
 * raise Node to 8 GB to survive it, while CI builds run at 4 GB. Turning maps on
 * for every build would therefore break the release and staging pipelines, and
 * would do so to produce files those builds strip and never upload.
 *
 * So emission follows the upload: the release build that has credentials
 * produces maps and ships them to the symbol server, and every other build stays
 * exactly as cheap as it was. Nothing is lost by that — an unuploaded map is
 * unreadable either way — and the coupling is the point, since maps and upload
 * are only ever useful together.
 *
 * `'hidden'` writes the `.map` files but omits the `//# sourceMappingURL=`
 * comment from the bundles, which is the right pairing for "upload, then strip":
 * a comment pointing at a file that has been stripped would leave every bundle
 * referencing a 404. Sentry matches maps by debug ID injected into both sides,
 * not by that comment, so nothing is lost.
 *
 * Coverage keeps the plain `true` it always had: istanbul's remapping reads the
 * sourceMappingURL comment, so `'hidden'` would quietly break coverage.
 */
const sourcemapMode =
  process.env.VITE_COVERAGE === 'true' ? true : sentryUploadConfigured ? ('hidden' as const) : false

/**
 * The release name stacks are attributed to. Must match what the crash reporter
 * sets at runtime (`restorm@<version>` in `services/crash/sentryComposition.ts`)
 * — a mismatch uploads the maps under a name no event ever carries, which fails
 * silently: reports still arrive, just permanently unsymbolicated.
 *
 * Read from package.json rather than `npm_package_version`, which is only
 * populated when the build runs through a package script. A direct build would
 * otherwise upload under `restorm@undefined` and symbolicate nothing.
 */
const appVersion = (JSON.parse(
  readFileSync(resolve(__dirname, 'package.json'), 'utf8')
) as { version: string }).version
const releaseName = `restorm@${appVersion}`

/**
 * Build-time constants shared by all three bundles.
 *
 * The crash DSN has to be BAKED IN: a packaged app launched from a desktop
 * launcher inherits no environment, so reading `process.env` at runtime left
 * every installed build with no DSN — crash reporting stayed inert in
 * production while the UI reported it as enabled, and not one report ever
 * arrived. A DSN is a public identifier (every reporting client carries it),
 * so embedding it discloses nothing; `RESTORM_SENTRY_DSN` in the build
 * environment supplies it, and an unconfigured build simply bakes in an empty
 * string and stays inert as before.
 */
const buildTimeDefines = {
  __RESTORM_SENTRY_DSN__: JSON.stringify(process.env.RESTORM_SENTRY_DSN ?? '')
}

/**
 * Source-map upload, per bundle. Returns an empty list when no credentials are
 * configured, so an ordinary build simply has no upload step rather than a
 * failing one.
 *
 * Deliberately NOT a hard failure when unconfigured. Crash reporting is inert
 * without a Sentry org anyway, and a build that refuses to produce an installer
 * because an optional diagnostic pipeline is unprovisioned has broken something
 * far more important than it protected.
 *
 * The plugin is told to delete NOTHING after uploading. Letting it clean up
 * would make the maps' removal a side effect of a step that only runs when
 * credentials exist, so an unconfigured build would ship them. Stripping is
 * instead unconditional, in package.json's `build.files`, and therefore holds
 * however this function resolves.
 */
function sentrySourcemapUpload(bundle: string): ReturnType<typeof sentryVitePlugin>[] {
  if (!sentryUploadConfigured) {
    console.log(`[sentry] source-map upload skipped for ${bundle}: no upload credentials configured`)
    return []
  }
  return [
    sentryVitePlugin({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      release: { name: releaseName },
      // Debug IDs are injected into both the bundle and its map, so a stack
      // frame is matched by identity rather than by guessing a URL. That is what
      // lets the maps be stripped from the package: nothing at runtime needs to
      // find them, Sentry resolves them server-side.
      sourcemaps: { filesToDeleteAfterUpload: [] },
      telemetry: false
    })
  ]
}

export default defineConfig({
  main: {
    define: buildTimeDefines,
    plugins: [
      externalizeDepsPlugin({ exclude: ['electron-core-ui'] }),
      copyTemplatesPlugin(),
      ...sentrySourcemapUpload('main')
    ],
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
      sourcemap: sourcemapMode,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        }
      }
    }
  },
  preload: {
    define: buildTimeDefines,
    // `zod` is excluded from externalization so it is BUNDLED into the preload
    // script. The preload imports the IPC output-shape schemas (../ipc/schemas),
    // which `import { z } from 'zod/v4'` as a runtime value. Left externalized,
    // electron-vite emits a bare `require('zod/v4')` that fails to resolve at
    // preload load → the module throws before `contextBridge.exposeInMainWorld`
    // runs → `window.restorm` is undefined → the renderer never signals ready.
    //
    // `@sentry/electron` is excluded for the same reason: the preload exposes
    // the crash SDK's IPC conduit, and a bare `require` of it at preload load is
    // the same single point of failure — one that would take the whole window
    // down to serve a subsystem that is supposed to be invisible. The bundled
    // module is a few dozen lines of `ipcRenderer.send` wrappers, so inlining it
    // costs nothing and removes the resolution question entirely.
    plugins: [
      externalizeDepsPlugin({ exclude: ['zod', '@sentry/electron'] }),
      ...sentrySourcemapUpload('preload')
    ],
    build: {
      // Output next to main/renderer under dist/ (electron-vite's default is
      // out/preload). electron-builder only packages dist/**, and in prod the
      // main resolves the preload at dist/preload/index.js — building it to
      // out/preload leaves it out of the package, so window.restorm is never
      // exposed and the (showWhenReady) window never appears. Keep it in dist/.
      outDir: 'dist/preload',
      sourcemap: sourcemapMode,
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
      sourcemap: sourcemapMode,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          editor: resolve(__dirname, 'src/renderer/editor.html')
        },
        output: {
          // Split each locale's translation.json into its own chunk. The 27
          // locales are statically imported and were otherwise bundled into a
          // single ~36 MB chunk, whose sourcemap generation exhausted the
          // release runner's memory (heap OOM at 8 GB; OS OOM at 12 GB — the
          // window is unworkable). Per-locale chunks (~1 MB each) keep peak
          // sourcemap memory bounded, so sourcemaps stay enabled everywhere.
          manualChunks(id: string): string | undefined {
            const m = /[/\\]locales[/\\]([^/\\]+)[/\\]translation\.json$/.exec(id)
            if (m) return `locale-${m[1]}`
            return undefined
          }
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
    plugins: [react(), rendererCoverageInstrumentationPlugin(), ...sentrySourcemapUpload('renderer')],
    optimizeDeps: {
      // Ne pas optimiser electron-core-ui
      exclude: ['electron-core-ui']
    },
    publicDir: resolve(__dirname, 'assets'),
    // Define env variables for test helpers
    define: {
      ...buildTimeDefines,
      'import.meta.env.VITE_ENABLE_TEST_HELPERS': JSON.stringify(process.env.VITE_ENABLE_TEST_HELPERS ?? 'false'),
      // Suppress Vue feature flag warnings from milkdown (which uses Vue internally)
      '__VUE_OPTIONS_API__': JSON.stringify(false),
      '__VUE_PROD_DEVTOOLS__': JSON.stringify(false),
      '__VUE_PROD_HYDRATION_MISMATCH_DETAILS__': JSON.stringify(false)
    }
  }
})
