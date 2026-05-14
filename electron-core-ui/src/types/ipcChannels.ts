/**
 * IPC channel names shared between the ECUI main process (`McpService`
 * built-in tools) and a consuming app's preload script. Keeping them in
 * one leaf module — imported by both sides — means the wire contract
 * has a single source of truth instead of duplicated string literals.
 */

/** MCP `open_mini_browser` → renderer: open / focus the Mini browser tab. */
export const MINI_BROWSER_OPEN_CHANNEL = 'mcp:mini-browser-open'

/** MCP `mini_browser_execute` → renderer: run a script in the webview guest. */
export const MINI_BROWSER_EXECUTE_CHANNEL = 'mcp:mini-browser-execute'

/** Renderer → main: result of a `mini_browser_execute` script. */
export const MINI_BROWSER_EXECUTE_REPLY_CHANNEL = 'mcp:mini-browser-execute-reply'

/** MCP `open_console` → renderer: open / focus the Console tab. */
export const CONSOLE_OPEN_CHANNEL = 'mcp:open-console'

/** MCP `console_clear` → renderer: wipe the Console feed buffer. */
export const CONSOLE_CLEAR_CHANNEL = 'mcp:console-clear'
