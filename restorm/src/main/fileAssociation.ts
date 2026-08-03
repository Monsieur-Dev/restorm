/**
 * Recognition of a `.restorm` project path handed to the app by the
 * operating system.
 *
 * When the OS opens a document with restorm — a double-click in
 * Explorer / Finder / Nautilus, "Open with", a drop on the dock icon —
 * it does NOT use the app's own `--open` flag. Windows and Linux append
 * the path to the process command line as a bare positional argument
 * (the desktop entry's `%f`); macOS delivers it out of band through
 * `app.on('open-file')` instead.
 *
 * This module owns only the recognition half — "is there a project path
 * in this argv, and which one" — as a pure function, so it can be tested
 * without a running Electron app. Where the recognised path is then sent
 * is the caller's business (see `src/main/index.ts`).
 *
 * Companion to `deepLink.ts`, which does the same job for `restorm://`
 * URLs arriving through the same two channels.
 */

/** The extension the app registers with the OS, lowercase, with its dot. */
export const PROJECT_FILE_EXTENSION = '.restorm'

/**
 * Returns true when `arg` looks like a path to a `.restorm` project.
 *
 * Deliberately does NOT touch the filesystem: recognition must be
 * decidable from argv alone, and a path that turns out not to exist is
 * the open path's problem to report, not a reason to ignore the
 * argument entirely (silently dropping it would look to the user like
 * the double-click did nothing).
 *
 * Anything beginning with `-` is treated as a flag, never a path, so an
 * option value can never be mistaken for a document. Chromium injects
 * its own switches into argv, and the app has its own flags too.
 */
export function isProjectFilePath(arg: string): boolean {
  if (arg.length === 0) return false
  if (arg.startsWith('-')) return false
  if (!arg.toLowerCase().endsWith(PROJECT_FILE_EXTENSION)) return false
  // A bare `.restorm` with no basename is a hidden file, not a project.
  const base = arg.split(/[\\/]/).pop() ?? ''
  return base.length > PROJECT_FILE_EXTENSION.length
}

/**
 * Extract the project path the OS asked the app to open, or `undefined`.
 *
 * Used for both channels Windows/Linux deliver a document through: the
 * cold-start `process.argv`, and the `argv` carried by the
 * `second-instance` event when the app is already running. The first
 * match wins — an OS-launched handler passes exactly one document, and
 * honouring several would mean deciding which one gets the window.
 *
 * `argv[0]` is the executable, which is skipped: a binary is never a
 * document. Callers that have already sliced argv can pass their slice —
 * the executable path does not end in `.restorm`, so a skipped or
 * retained argv[0] gives the same answer either way.
 */
export function findProjectFileInArgv(argv: readonly string[]): string | undefined {
  return argv.slice(1).find((arg) => isProjectFilePath(arg))
}
