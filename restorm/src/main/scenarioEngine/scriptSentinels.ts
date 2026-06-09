/**
 * Lightweight, dependency-free constants shared between the QuickJS sandbox
 * shim ({@link codeSandbox}) and the `code` executor. Kept in its own module so
 * importing the executor (and therefore the whole scheduler) does NOT eagerly
 * pull in `codeSandbox` — which statically loads the heavy esbuild/QuickJS WASM
 * deps and would otherwise break every scheduler unit test under jsdom.
 */

/** Sentinel `nextRequest` value written by `pm.execution.skipRequest()` /
 * Bruno's `bru.runner.skipRequest()` — the httpRequest the pre-request script
 * feeds skips its network call when it sees this on the incoming request
 * override. The Postman/Bruno shims write the same literal verbatim. */
export const SKIP_REQUEST_SENTINEL = '\u0000skip'
