import { computeChecksum } from 'electron-core-ui/renderer'

/**
 * Deep-snapshot a live document, then checksum it — tolerating a document too
 * large to serialize.
 *
 * Several dirty-state paths defer a `computeChecksum(JSON.parse(JSON.stringify(
 * doc)))` (often inside a `setTimeout`) to snapshot a node at a fixed moment,
 * before a later mutation. `computeChecksum` is itself safe (it catches its own
 * stringify failure and returns `''`), but the **pre-clone** — the
 * `JSON.parse(JSON.stringify(doc))` its caller builds — is not: on a
 * pathologically large project (e.g. an enormous gRPC-reflection import) that
 * `JSON.stringify` throws `RangeError: Invalid string length` straight out of
 * the timer, an unhandled rejection that crashes the renderer.
 *
 * Routing the snapshot through here makes the clone safe: an over-size document
 * yields `''`, which matches `computeChecksum`'s own contract for an
 * unserializable input, so the dirty-state machinery already tolerates it.
 * Any other error is a genuine bug and is rethrown unchanged.
 */
export function computeChecksumSnapshot(doc: unknown): string {
  let snapshot: unknown
  try {
    snapshot = JSON.parse(JSON.stringify(doc))
  } catch (error) {
    if (error instanceof RangeError) return ''
    throw error
  }
  return computeChecksum(snapshot)
}
