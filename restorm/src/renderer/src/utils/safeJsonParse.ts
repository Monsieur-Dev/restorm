/**
 * Parse JSON string safely, returning undefined on failure instead of throwing.
 */
export function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}
