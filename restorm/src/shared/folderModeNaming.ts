/**
 * Folder-mode on-disk naming primitives — how a saved project names its
 * directories/files: `<zero-padded index> - <sanitized name>` per sibling.
 * Shared so the headless-CLI scenario path (and its resolver) match exactly the
 * paths a user sees when the project is saved in folder mode.
 */

/** Zero-pad width for an index among `count` siblings (so `9`→`09` when ≥10). */
export function getPaddingWidth(count: number): number {
  if (count <= 0) return 1
  return String(count).length
}

/** `<1-based, zero-padded index>` of an item among `count` siblings. */
export function formatIndex(index: number, count: number): string {
  const width = getPaddingWidth(count)
  return String(index + 1).padStart(width, '0')
}

/** Strip filesystem-invalid characters from a name for a folder-mode segment. */
export function sanitizeName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '_') // Replace invalid characters
    .replace(/\s+/g, ' ')          // Normalize whitespace
    .trim()
    .slice(0, 100)                 // Limit length
}
