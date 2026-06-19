/**
 * Deterministic id generation for importers.
 *
 * Re-importing the same source document must produce the same ids so the
 * idempotent-import diff can match existing items instead of duplicating them.
 * A random suffix (Date.now / Math.random) defeats that: two imports of one
 * file yield different ids and every item looks "new". Seeding a stable hash
 * from a discriminator that is intrinsic to the source (path, key, operation)
 * keeps ids stable across runs.
 *
 * The output is shaped like a UUID so it slots into id fields that expect that
 * format. It is NOT a cryptographic identifier — it only needs to be stable and
 * collision-resistant enough across a single document's items.
 */
function hashSeed(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash
  }
  const hex = Math.abs(hash).toString(16).padStart(8, '0')
  return `${hex}-${seed.length.toString(16).padStart(4, '0')}-4000-8000-${hex}${hex.slice(0, 4)}`
}

/**
 * Returns a UUID-shaped id derived from `seed`. With no seed (or an empty one),
 * falls back to a random UUID — use that only for items with no stable
 * discriminator.
 */
export function stableImportId(seed?: string): string {
  if (!seed) return crypto.randomUUID()
  return hashSeed(seed)
}
