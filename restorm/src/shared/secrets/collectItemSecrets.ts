import { isSecretValue } from '../utils/valueHelpers'
import { isRequest, isScenario, type FolderItem } from '../types/folderTypes'
import type { SecretValue } from '../types/valueTypes/SecretValue'
import type { ValueType } from '../types/valueTypes/BaseValueType'

/**
 * Deep-collect every {@link SecretValue} held directly inside an arbitrary
 * value tree (objects + arrays), guarding against cycles. A secret is a leaf —
 * once found we stop descending (its `params` are configuration, not nested
 * secrets). Robust to (de)serialization: `isSecretValue` matches both the class
 * instance and the plain `{ type: 'secret', … }` shape.
 */
function collectSecretsDeep(root: unknown, out: SecretValue[], seen: Set<object>): void {
  if (root === null || typeof root !== 'object') return
  if (seen.has(root)) return
  seen.add(root)
  if (isSecretValue(root as ValueType)) {
    out.push(root as SecretValue)
    return
  }
  if (Array.isArray(root)) {
    for (const el of root) collectSecretsDeep(el, out, seen)
    return
  }
  for (const key of Object.keys(root)) {
    collectSecretsDeep((root as Record<string, unknown>)[key], out, seen)
  }
}

/**
 * The `SecretValue`s a single tree item holds DIRECTLY in its own fields —
 * a request's headers / params / path-params / auth / body, or a scenario's
 * node configs. It deliberately does NOT descend into a scenario's child
 * `items` or a folder's children: those are separate tree items with their own
 * resolution status, and the env-folder's own variables are handled by the
 * per-environment subsystem, not here.
 *
 * Drives the per-item "secret resolving / errored" badge: a request or scenario
 * that embeds a secret resolves it eagerly, and this is how we enumerate what to
 * resolve + watch.
 */
export function collectItemDirectSecrets(item: FolderItem): SecretValue[] {
  const out: SecretValue[] = []
  const seen = new Set<object>()
  if (isScenario(item)) {
    // Only the graph's node configs — not the scenario's child items.
    for (const node of item.nodes) collectSecretsDeep(node.config, out, seen)
  } else if (isRequest(item)) {
    // A request has no child items, so the whole object is safe to walk.
    collectSecretsDeep(item, out, seen)
  }
  // Folders / env-folders hold no direct secrets of their own here.
  return out
}

/**
 * Typed-value kinds that are LITERAL — a `{{name}}` inside them is plain text,
 * never handlebars-resolved, so it does NOT reference the variable. Only an
 * `expression` value (and bare resolved string fields like a request's url)
 * actually substitutes variables. A `secret` value is a DIRECT secret, handled
 * by {@link collectItemDirectSecrets}, not a reference.
 */
const LITERAL_VALUE_KINDS = new Set([
  'string', 'number', 'boolean', 'color', 'dateTime', 'secret',
  'enum', 'enumList', 'customList', 'customListMulti', 'variable', 'null', 'environment'
])

/**
 * Collect every variable identifier an item actually RESOLVES via `{{ … }}` —
 * from its `expression`-typed values and its bare resolved string fields (a
 * request's url, a raw body), but NOT from `string`-typed values, where
 * `{{apiKey}}` is literal text. Used for the reference-aware inherited badge: an
 * item lights only when it genuinely uses a failing secret variable, not merely
 * because its environment has one. Over-captures helper names etc., but callers
 * intersect with the secret variable names that errored, so spurious tokens
 * never match.
 */
export function collectItemReferencedVars(item: FolderItem): Set<string> {
  const out = new Set<string>()
  const seen = new Set<object>()
  const addFromString = (s: string): void => {
    const blocks = s.match(/\{\{([^}]*)\}\}/g)
    if (!blocks) return
    for (const block of blocks) {
      for (const id of block.match(/[A-Za-z_$][\w$]*/g) ?? []) out.add(id)
    }
  }
  const walk = (v: unknown): void => {
    // A bare string field (url, raw body, …) IS handlebars-resolved.
    if (typeof v === 'string') { addFromString(v); return }
    if (v === null || typeof v !== 'object') return
    if (seen.has(v)) return
    seen.add(v)
    if (Array.isArray(v)) { for (const el of v) walk(el); return }
    const kind = (v as { type?: unknown }).type
    if (typeof kind === 'string') {
      // Only expression values substitute variables; read their template.
      if (kind === 'expression') {
        const expr = (v as { value?: unknown }).value
        if (typeof expr === 'string') addFromString(expr)
        return
      }
      // Literal / non-handlebars typed values: a `{{x}}` inside is plain text.
      // (`list` / `object` aren't listed → fall through to recurse, since they
      // can nest expression values.)
      if (LITERAL_VALUE_KINDS.has(kind)) return
    }
    for (const key of Object.keys(v)) walk((v as Record<string, unknown>)[key])
  }
  if (isScenario(item)) {
    for (const node of item.nodes) walk(node.config)
  } else if (isRequest(item)) {
    walk(item)
  }
  return out
}
