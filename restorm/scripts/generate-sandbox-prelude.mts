/**
 * Build-time generator for the code-node sandbox's standard-library prelude.
 *
 * Runs as part of `prebuild` and writes `resources/sandbox-stdlib-prelude.js`,
 * shipped by electron-builder into `restorm-resources/` (OUTSIDE app.asar).
 * A packaged app cannot bundle the prelude at runtime: the esbuild binary is a
 * separate process that sees `app.asar` as a plain file and can never resolve
 * the curated packages inside the archive. Dev builds keep bundling on the fly
 * (`codeSandbox.getStdlibPrelude` falls back when the asset is absent).
 *
 * Plain Node (type-stripped TS import) — no Electron, no bundler.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildStdlibPrelude } from '../src/main/scenarioEngine/sandboxStdlib.ts'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const outPath = join(packageRoot, 'resources', 'sandbox-stdlib-prelude.js')

const prelude = await buildStdlibPrelude(packageRoot)
if (!prelude.includes('globalThis')) {
  throw new Error('generated sandbox prelude looks wrong (no globalThis assignment)')
}
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, prelude)
console.log(`sandbox stdlib prelude → ${outPath} (${(prelude.length / 1024).toFixed(0)} KiB)`)
