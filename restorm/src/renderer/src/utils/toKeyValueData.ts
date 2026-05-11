import { isExpressionValue } from '../../../shared/utils/valueHelpers'
import { normalizeValueType } from './normalizeValueType'
import type { KeyValue } from '../../../shared/types/baseTypes'
import type { KeyValueData } from '../types/global'

/**
 * Serialise a `KeyValue` array for the `context.registerRequest`
 * IPC bridge. The IPC schema only knows strings, so every
 * `ValueType` has to be flattened — but we also preserve a single
 * `isExpression` bit so the main side can reconstruct an
 * `ExpressionValue` (vs the default `StringValue`) before the
 * handlebars resolver runs at request time.
 *
 * Without that flag, every header / param value the user typed got
 * handlebars-substituted at send time regardless of its declared
 * type — a `StringValue("{{token}}")` sent verbatim was supposed
 * to mean "no templating", but the renderer used to throw the
 * `ValueType` away on the way to main, so the substitution
 * happened anyway.
 *
 * Shared so every request-tab view (HTTP / GraphQL / WS / SOAP /
 * OData / gRPC) produces the same shape; the helpers each tab
 * used to inline diverged slightly (some carried `enabled`, some
 * didn't, etc.) and the divergence is what let the
 * `isExpression` field drop on the floor.
 */
export function toKeyValueData(kvs: readonly KeyValue[]): KeyValueData[] {
	return kvs.map((kv) => {
		const normalized = normalizeValueType(kv.value as unknown)
		const out: KeyValueData = {
			key: kv.key,
			value: normalized.toString()
		}
		if (kv.id !== undefined) out.id = kv.id
		if (kv.enabled !== undefined) out.enabled = kv.enabled
		if (isExpressionValue(normalized)) out.isExpression = true
		return out
	})
}
