/**
 * Strip identity / structural keys from an IPC- or renderer-sourced
 * update patch before it's `Object.assign`-ed onto a live node.
 *
 * `Object.assign(node, updates)` blindly copies whatever the patch
 * carries — including `id` (which would re-key the node out from under
 * every UUID-keyed store) and `items` (which would replace the live
 * children array wholesale, orphaning sub-trees). The metadata-update
 * paths only ever legitimately change scalar fields (name, notes, tags,
 * type-specific config); the tree shape + identity are owned elsewhere.
 */
export function sanitizeUpdatePatch<T extends object>(updates: T, extraForbidden: readonly string[] = []): Partial<T> {
  const forbidden = new Set<string>(['id', ...extraForbidden])
  const clean: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(updates as Record<string, unknown>)) {
    if (forbidden.has(key)) continue
    clean[key] = value
  }
  return clean as Partial<T>
}
