import { isExpressionValue, isCustomListValue, isCustomListMultiValue, isSecretValue } from '../../../shared/utils/valueHelpers'
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
		// Custom-list values carry only a label in `value` (their
		// `toString()`); main needs the list id + label(s) to substitute
		// the entry value at dispatch, so ship the structured shape too.
		// Without it the label would be sent verbatim (and silently look
		// correct whenever label === value).
		else if (isCustomListValue(normalized)) out.customList = { listId: normalized.listId, label: normalized.label }
		else if (isCustomListMultiValue(normalized)) out.customListMulti = { listId: normalized.listId, labels: normalized.labels }
		// Secret values flatten to an empty `value` (the resolved plaintext
		// never leaves main); ship the `source` + `params` so main can
		// reconstruct the SecretValue and hydrate it from its source at
		// dispatch instead of sending an empty header. Force the value to
		// empty regardless of `toString()` so a stray renderer-side
		// `resolved` plaintext can never ride the bridge.
		else if (isSecretValue(normalized)) {
			out.value = ''
			out.secret = { source: normalized.source, params: normalized.params }
		}
		return out
	})
}
