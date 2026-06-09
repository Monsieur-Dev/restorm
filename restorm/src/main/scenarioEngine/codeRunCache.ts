/**
 * In-memory cache of each `code` node's last run output, keyed by node id.
 *
 * The inspector preview lets the user pick a property from a box's last result.
 * For `httpRequest` boxes that data is read back from the request's on-disk
 * history; a `code` box has no such history, so its executor records the
 * freshest `{ result, logs }` here and the preview resolver reads it back. The
 * cache is process-lived (cleared on restart) — a preview is always "the last
 * time this box actually ran", never stale persisted state.
 */
export interface CodeRunRecord {
  result: unknown
  logs: string[]
  timestamp: string
}

const lastRunByNode = new Map<string, CodeRunRecord>()

/** Cap on retained records: a preview only ever needs the most-recently-run
 * boxes, and a node's result can be arbitrarily large, so bound the map rather
 * than letting it grow for the whole session. Map keeps insertion order, so the
 * oldest entry is `keys().next()`. */
const MAX_RECORDS = 256

/** Record a code node's freshest run output (called from `codeExecutor`). */
export function recordCodeRun(nodeId: string, record: CodeRunRecord): void {
  // Re-insert at the end so a re-run refreshes recency (delete then set).
  lastRunByNode.delete(nodeId)
  lastRunByNode.set(nodeId, record)
  if (lastRunByNode.size > MAX_RECORDS) {
    const oldest = lastRunByNode.keys().next().value
    if (oldest !== undefined) lastRunByNode.delete(oldest)
  }
}

/** Read a code node's last run output, or `undefined` if it never ran. */
export function getCodeRun(nodeId: string): CodeRunRecord | undefined {
  return lastRunByNode.get(nodeId)
}
