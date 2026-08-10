import { SecretValue } from '../../../shared/types/valueTypes/SecretValue'

/**
 * Digest of every env-file secret PLAINTEXT reachable under a node.
 *
 * The save-unit pipeline strips `resolved` (SecretValue.toJSON) from both
 * the hydrated reference and every draft, so a secret-only edit produces a
 * draft identical to the reference — the registry discards it as a revert,
 * no dirty transition fires, and the autosave never runs. Stamping this
 * digest NEXT TO the unit content (as `__envSecretsDigest`, on both the
 * reference and the drafts) makes the plaintext delta visible to the
 * registry's structural compare without ever putting the plaintext itself
 * in a persisted shape: the registry only tracks dirtiness — the on-disk
 * bytes are always serialized from the live tree, never from a draft.
 *
 * Returns `null` when the subtree holds no env-file secret at all, so
 * secret-less units keep their exact historical shape.
 */
export function envSecretsDigestOf(node: unknown): string | null {
  const pairs: [string, string][] = []
  walkForSecrets(node, '$', pairs, new Set())
  if (pairs.length === 0) return null
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  return JSON.stringify(pairs)
}

function isEnvFileSecretPojo(rec: Record<string, unknown>): boolean {
  return rec['type'] === 'secret' && rec['source'] === 'envFileSecret'
}

function walkForSecrets(node: unknown, path: string, out: [string, string][], seen: Set<object>): void {
  if (!node || typeof node !== 'object') return
  if (seen.has(node)) return
  seen.add(node)

  if (node instanceof SecretValue) {
    if (node.source === 'envFileSecret') {
      const key = typeof node.params['key'] === 'string' && node.params['key'] !== '' ? node.params['key'] : path
      out.push([key, node.resolved ?? ''])
    }
    return
  }
  if (Array.isArray(node)) {
    node.forEach((child, i) => { walkForSecrets(child, `${path}[${String(i)}]`, out, seen) })
    return
  }
  const rec = node as Record<string, unknown>
  if (isEnvFileSecretPojo(rec)) {
    const params = rec['params']
    const paramKey = params && typeof params === 'object' ? (params as Record<string, unknown>)['key'] : undefined
    const key = typeof paramKey === 'string' && paramKey !== '' ? paramKey : path
    out.push([key, typeof rec['resolved'] === 'string' ? rec['resolved'] : ''])
    return
  }
  for (const [k, v] of Object.entries(rec)) {
    if (v && typeof v === 'object') walkForSecrets(v, `${path}.${k}`, out, seen)
  }
}

/**
 * Find the LIVE node carrying `runtimeId` anywhere in the tree — items,
 * environments and sub-environments included (save units exist for all
 * three). Used to compute the reference digest at hydration time.
 */
export function findNodeByRuntimeId(roots: unknown[], runtimeId: string): unknown {
  for (const root of roots) {
    const hit = findIn(root, runtimeId, new Set())
    if (hit) return hit
  }
  return null
}

function findIn(node: unknown, runtimeId: string, seen: Set<object>): unknown {
  if (!node || typeof node !== 'object') return null
  if (seen.has(node)) return null
  seen.add(node)
  const rec = node as Record<string, unknown>
  if (rec['id'] === runtimeId) return node
  for (const childKey of ['items', 'environments', 'subEnvironments'] as const) {
    const children = rec[childKey]
    if (Array.isArray(children)) {
      for (const child of children) {
        const hit = findIn(child, runtimeId, seen)
        if (hit) return hit
      }
    }
  }
  return null
}
