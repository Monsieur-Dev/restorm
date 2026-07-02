/**
 * Naming shared by the `code` node's JS/TS runtime and its Monaco editor: an npm
 * package name is rarely a valid JS identifier (`just-snake-case`, `@scope/name`,
 * `left.pad`), but a user-pinned package is exposed as BOTH `require('<name>')`
 * (the real name, no transform needed) AND a bare global (which does need one).
 * This is the single place that turns a package name into that global's
 * identifier, so the main-process injection (`codeSandbox.ts`) and the Monaco
 * `.d.ts` globals (`ScenarioCodeField.tsx`) can never drift apart.
 */

/** Snake-case an npm package name into a valid JS identifier: every character
 * that can't appear in an identifier becomes `_`, and a leading digit gets a
 * `_` prefix (identifiers can't start with one). Collisions between distinct
 * package names are possible but rare (mirrors how the curated `SANDBOX_LIBS`
 * already assigns one flat global per lib) — last pinned package wins. */
export function npmPackageGlobalName(name: string): string {
  const snake = name.replace(/[^a-zA-Z0-9_$]/g, '_')
  if (snake === '') return '_pkg'
  return /^[0-9]/.test(snake) ? `_${snake}` : snake
}
