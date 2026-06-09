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
import type { SandboxNetworkBridge, SandboxVariableBridge, SandboxScriptContext, SandboxScriptOutcome } from '../codeSandbox'

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
  /** Optional host variable bridge — read/WRITE access to the run's variables
   * (foundation for `pm.*` / `bru.*`). Only the JS sandbox uses it; others
   * ignore it (Postman/Bruno scripts are JavaScript). */
  variableBridge?: SandboxVariableBridge
  /** Optional Postman script context — runs the code as a verbatim Postman
   * pre/post-request script (`pm.*`). JS runtime only. */
  postman?: SandboxScriptContext
  /** Optional Bruno script context — runs the code as a verbatim Bruno script
   * (`bru`/`req`/`res`). JS runtime only. */
  bruno?: SandboxScriptContext
}

export interface CodeRunResult {
  /** The value the script returned (JSON-cloneable). */
  result: unknown
  /** Lines the script wrote to stdout / print / console — surfaced to run-log. */
  logs: string[]
  /** Present for a Postman/Bruno script run: the request mutations, test results
   * and `setNextRequest`/`runRequest` the script produced. */
  postman?: SandboxScriptOutcome
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
