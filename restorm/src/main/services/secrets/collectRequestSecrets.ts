import type { KeyValue } from '../../../shared/types/collections'
import type { SecretValue } from '../../../shared/types/valueTypes/SecretValue'
import { isSecretValue } from '../../../shared/utils/valueHelpers'

/**
 * Collect every `SecretValue` reachable from a request's resolved
 * KeyValue groups (headers, query params, path params, …). These are
 * the rows the execution services iterate verbatim through
 * `ContextService.resolveKeyValueForRequest`, whose sync path returns
 * `value.toString()` — empty for a `SecretValue` unless hydration ran
 * first.
 *
 * The input mirrors `RequestContext.keyValueGroups` (group name →
 * `KeyValue[]`) so the caller passes exactly what the executor already
 * has in hand. Disabled rows are skipped: they never reach the wire,
 * so resolving their secret would be a needless resolver call (and, for
 * sources with side effects / rate limits, undesirable).
 */
export function collectRequestSecrets(
  keyValueGroups: Map<string, KeyValue[]> | undefined
): SecretValue[] {
  if (!keyValueGroups) return []
  const secrets: SecretValue[] = []
  for (const group of keyValueGroups.values()) {
    for (const kv of group) {
      if (kv.enabled === false) continue
      if (isSecretValue(kv.value)) {
        secrets.push(kv.value)
      }
    }
  }
  return secrets
}
