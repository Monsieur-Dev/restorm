/**
 * Runtime-registry contract for the `code` node. Each supported language plugs
 * in one {@link CodeRuntime} — the node itself never names a language, it just
 * looks one up by `config.language` and calls `run`. New languages (Python,
 * Ruby, Lua, PHP, R, …) are added by registering a runtime, with no change to
 * the executor or the box.
 *
 * The injection model is identical across languages: the wired `value` input is
 * exposed to the script, run variables are exposed, the script's return value
 * flows to the `result` port, and stdout / print / console output becomes
 * user run-log lines. An error or a timeout rejects → the scheduler routes to
 * the node's `error` port.
 */
import type { SandboxNetworkBridge } from '../codeSandbox'

export interface CodeRunContext {
  /** The node's wired/inline input value, exposed to the script. */
  input?: unknown
  /** Run variables (input / setVariable nodes), exposed to the script. */
  variables?: Record<string, unknown>
  /** Wall-clock execution budget in ms; a runaway script is killed after it. */
  timeoutMs: number
  /** Cooperative-cancellation signal (user Stop / scope abort). */
  signal?: AbortSignal
  /** Optional host network bridge (firewall-routed `fetch` / `pm.sendRequest`).
   * Only runtimes that opt into network access use it; others ignore it. */
  network?: SandboxNetworkBridge
}

export interface CodeRunResult {
  /** The value the script returned (JSON-cloneable). */
  result: unknown
  /** Lines the script wrote to stdout / print / console — surfaced to run-log. */
  logs: string[]
}

export interface CodeRuntime {
  /** The languages this runtime serves (e.g. `['typescript', 'javascript']`). */
  readonly languages: readonly string[]
  /** Run `code` with the given context, resolving to its result + logs, or
   * rejecting on a script error / timeout. */
  run(code: string, ctx: CodeRunContext): Promise<CodeRunResult>
  /** Optional teardown (dispose pooled workers). Not required for correctness —
   * the engine never assumes a runtime is reusable across runs. */
  terminate?(): void | Promise<void>
}
