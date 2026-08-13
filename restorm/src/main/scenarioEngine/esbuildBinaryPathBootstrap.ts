/**
 * LOAD-ORDER CRITICAL: esbuild reads `ESBUILD_BINARY_PATH` ONCE, at module
 * load (a module-scope capture in its lib — later `process.env` writes are
 * ignored). Every esbuild import in this app is behind a dynamic `import()`,
 * so setting the variable during THIS module's own initialization — imported
 * from the main entry before anything else can pull esbuild — guarantees the
 * packaged-app override is in place before the capture happens.
 */
import { ensureEsbuildBinaryResolvable } from './esbuildBinaryPath'

ensureEsbuildBinaryResolvable()
