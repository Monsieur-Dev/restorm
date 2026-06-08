import axios from 'axios'
import type { SandboxHttpRequest, SandboxHttpResponse } from './codeSandbox'

/**
 * Host network bridge for the `code` node's sandbox `fetch` / `pm.sendRequest`.
 *
 * The sandbox holds NO real network primitive; it asks the trusted host (here)
 * to perform the request. Crucially this goes through the app's normal HTTP
 * stack and is **NOT** wrapped in `withFirewallBypass`, so the main-process
 * firewall interceptor (which patches `net.Socket.connect` / DNS at the lowest
 * level) governs it exactly like a real `httpRequest` node: a call to a
 * non-whitelisted host triggers the firewall prompt / denial. A blocked or
 * failed request is reported as `error` (which the sandbox turns into a clean
 * in-script throw) rather than throwing here — so a malicious script can never
 * reach the network, or exfiltrate, without the firewall seeing it.
 *
 * 4xx/5xx are returned (not thrown), mirroring `fetch` semantics. `signal`
 * aborts an in-flight request when the run ends (timeout / completion).
 */
export async function codeNetworkBridge(req: SandboxHttpRequest, signal: AbortSignal): Promise<SandboxHttpResponse> {
  try {
    const resp = await axios.request({
      url: req.url,
      method: req.method,
      headers: req.headers,
      ...(req.body !== undefined ? { data: req.body } : {}),
      signal,
      responseType: 'text',
      // Keep the raw string body — don't let axios JSON-parse it (the sandbox
      // shim's `.json()` parses on demand, matching fetch).
      transformResponse: [(d: unknown) => d],
      // Never throw on status — a 404/500 is a valid response the script reads.
      validateStatus: () => true,
      maxRedirects: 5
    })
    const headers: Record<string, string> = {}
    for (const [key, value] of Object.entries(resp.headers as Record<string, string | string[] | undefined>)) {
      if (value == null) continue
      headers[key] = Array.isArray(value) ? value.join(', ') : value
    }
    return {
      status: resp.status,
      statusText: resp.statusText,
      headers,
      body: typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data)
    }
  } catch (err) {
    return { status: 0, statusText: '', headers: {}, body: '', error: bridgeErrorMessage(err) }
  }
}

/** A non-empty, readable message for a transport / firewall failure. Must never
 * be empty: the sandbox shim treats a falsy `error` as "no error". */
function bridgeErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message !== '') return err.message
  if (typeof err === 'string' && err !== '') return err
  return 'network request failed'
}
