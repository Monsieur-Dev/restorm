/** Default HTTP/GraphQL/SOAP request timeout in milliseconds */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

/** Default WebSocket connection timeout in milliseconds */
export const DEFAULT_WS_TIMEOUT_MS = 5_000

/** Default UI debounce/delay in milliseconds */
export const DEFAULT_UI_DELAY_MS = 3_000

/**
 * Hard cap on the number of response bytes any single protocol
 * executor (HTTP / GraphQL / SOAP / auth prefetch) or the scenario
 * sandbox network bridge will buffer in the main process before it
 * destroys the socket and rejects. Without this a hostile / runaway
 * endpoint streaming an unbounded body OOMs the main process. 64 MiB
 * is generous for any realistic API response while still bounding the
 * blast radius.
 */
export const MAX_RESPONSE_BYTES = 64 * 1024 * 1024
