/**
 * Headless side effect that MUST run before anything touches the ECUI logger.
 *
 * In CLI-run mode (`--run`), stdout is reserved for the scenario run-log — no
 * diagnostic noise allowed. ECUI's logger attaches a console transport whenever
 * it runs unpackaged (`isDev`), and it reads `process.argv` lazily on its first
 * use. The earliest log call happens while modules initialise, BEFORE any
 * top-level statement in `index.ts` could lower the level. So we inject ECUI's
 * generic `--quiet` flag here — this file is imported FIRST in `index.ts`, so by
 * the time the logger is first created `--quiet` is already in `process.argv`
 * and the console transport is never attached.
 *
 * Importing this module has no effect outside CLI-run mode.
 */
if (process.argv.includes('--run') && !process.argv.includes('--quiet') && !process.argv.includes('-q')) {
  process.argv.push('--quiet')
}
