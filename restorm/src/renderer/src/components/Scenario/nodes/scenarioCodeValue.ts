/** The payload/code is stored as a plain code string, but a scenario authored
 * before the code editor (or via MCP) may carry a `{ type:'string', value }`
 * typed value — read either shape back into the editor. */
export function readCodeString(v: unknown): string {
  if (typeof v === 'string') return v
  const inner = (v as { value?: unknown } | null | undefined)?.value
  return typeof inner === 'string' ? inner : ''
}
