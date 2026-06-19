/**
 * Shared KeyValue resolution helpers for the protocol request services
 * (HTTP / SOAP / GraphQL / gRPC). These were copy-pasted five times with
 * subtle divergence (one variant dropped fields the others preserved); a single
 * source keeps the resolution rule identical across protocols.
 */
import type { KeyValue } from '../../../shared/types/collections'
import { StringValue } from '../../../shared/types/collections'
import type { VariableContext } from './types'
import { resolveTemplate } from './resolveTemplate'

/**
 * Resolve handlebars templates in each KeyValue's key + value against the
 * variable context. Preserves every other field (description, enabled, id, …)
 * via spread so resolution never silently drops metadata.
 */
export function resolveKeyValues(keyValues: KeyValue[], context: VariableContext): KeyValue[] {
  return keyValues.map((kv) => ({
    ...kv,
    key: resolveTemplate(kv.key, context),
    value: new StringValue(resolveTemplate(kv.value.toString(), context))
  }))
}

/** Flatten a KeyValue list to a `{ key: value }` header object (skipping
 * empty-key rows). Last value wins on a duplicate key. */
export function headersToObject(headers: KeyValue[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const h of headers) {
    if (h.key) {
      result[h.key] = h.value.toString()
    }
  }
  return result
}

/** Collision-free response id (was a Date.now()+Math.random() suffix
 * duplicated across the request services — two responses in the same ms could
 * collide). */
export function generateResponseId(): string {
  return `resp_${crypto.randomUUID()}`
}
