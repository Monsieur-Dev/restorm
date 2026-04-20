/**
 * Renderer log guard for BDD fixtures.
 *
 * The BDD fixtures in `tests/e2e/bdd/fixtures/` each capture every
 * renderer message and page error into a shared log buffer. Historically
 * those were only attached to the test output for post-mortem reading —
 * a scenario that silently emitted `Maximum update depth exceeded` or
 * `The result of getSnapshot should be cached` still "passed". The
 * OYO-203 perf regression (infinite re-render loop from a non-memoised
 * `getSnapshot`) is exactly the class of bug that would have been
 * caught long ago if the fixtures had failed on console errors.
 *
 * This module centralises the gate: given a concatenated log buffer
 * (lines prefixed with `[renderer:error]`, `[renderer:warning]`,
 * `[renderer:pageerror]`, etc.), `collectBlockingRendererMessages`
 * returns the subset that should fail a green scenario. Allow-listed
 * patterns live here; keep the list tight and tighten it further as
 * legitimate noise gets cleaned up.
 */

/**
 * Patterns that are considered harmless enough to ignore when deciding
 * whether a scenario should fail on renderer output. Anything NOT
 * matched here — in `[renderer:error]`, `[renderer:warning]` lines
 * containing the critical React signals, or any `[renderer:pageerror]`
 * — blocks the scenario.
 *
 * Prefer adding a narrowly-scoped regex with a short comment explaining
 * why the noise is acceptable; resist broadening an existing pattern.
 */
const ALLOWLISTED_RENDERER_LINES: RegExp[] = [
  // DevTools autofill errors that Chromium emits on every input mount.
  /Autofill\.(enable|setAddresses|getNodesForSubtreeByStyle)/,
  // Vite dev-server transient errors during HMR that don't affect
  // the already-loaded app (we run against the built dist in e2e so
  // this only shows up if the build got out of sync — not runtime).
  /Failed to resolve import.*electron-core-ui/,
  /Pre-transform error/,
  /Failed to load resource: the server responded with a status of 5\d{2}/,
  // Some Monaco editor features warn when they can't find web workers
  // in non-browser Electron bundling — cosmetic, not a bug.
  /Could not create web worker.*Monaco/
]

/**
 * Critical React/console signals that must fail the scenario even when
 * they land on a `[renderer:warning]` line (React emits the
 * "getSnapshot should be cached" message as a warning, not an error).
 */
const CRITICAL_WARNING_PATTERNS: RegExp[] = [
  /result of getSnapshot should be cached/i,
  /Maximum update depth exceeded/i,
  /Rendered more hooks than during the previous render/i,
  /Cannot update a component.*while rendering a different component/i
]

function isAllowlisted(line: string): boolean {
  return ALLOWLISTED_RENDERER_LINES.some((re) => re.test(line))
}

/**
 * Return the subset of log lines that should fail a passing scenario.
 *
 * Rules:
 *   - Any `[renderer:pageerror]` line (uncaught exception) — always.
 *   - Any `[renderer:error]` line — unless explicitly allow-listed.
 *   - Any `[renderer:warning]` line matching one of the critical React
 *     signals (getSnapshot, Maximum update depth, …) — unless allow-listed.
 */
export function collectBlockingRendererMessages(logs: string[]): string[] {
  const blocking: string[] = []
  for (const line of logs) {
    if (isAllowlisted(line)) continue
    if (line.startsWith('[renderer:pageerror]')) {
      blocking.push(line)
      continue
    }
    if (line.startsWith('[renderer:error]')) {
      blocking.push(line)
      continue
    }
    if (line.startsWith('[renderer:warning]')) {
      if (CRITICAL_WARNING_PATTERNS.some((re) => re.test(line))) {
        blocking.push(line)
      }
    }
  }
  return blocking
}

/**
 * Build a trimmed error summary from blocking log lines — keeps output
 * readable when dozens of identical "Maximum update depth exceeded"
 * messages fire in a loop.
 */
export function summariseBlockingMessages(lines: string[], limit = 10): string {
  const seen = new Map<string, number>()
  for (const line of lines) {
    // Collapse long stack-trace tails so the dedup key matches repeats
    // of the same root error.
    const key = line.split('\n')[0].slice(0, 240)
    seen.set(key, (seen.get(key) ?? 0) + 1)
  }
  const entries = Array.from(seen.entries()).sort((a, b) => b[1] - a[1])
  const shown = entries.slice(0, limit)
    .map(([key, count]) => (count > 1 ? `  [×${count}] ${key}` : `  ${key}`))
    .join('\n')
  const trailer = entries.length > limit
    ? `\n  … and ${entries.length - limit} more distinct message(s).`
    : ''
  return `${lines.length} blocking renderer message(s) (top ${Math.min(limit, entries.length)}):\n${shown}${trailer}`
}
