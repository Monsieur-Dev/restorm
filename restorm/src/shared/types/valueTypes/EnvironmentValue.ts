import { StringBackedValue } from './BaseValueType'

/**
 * A reference to an environment by its (globally-unique) id. Stored as the bare
 * env id; the runtime resolves it to that environment when a node reads it.
 *
 * Surfaces in the value selector's environment picker — a button (no submenu)
 * that lists every environment across all environment folders. Offered on the
 * nodes that accept an environment (input, if, switch, assert, comparator,
 * set/getVariable) and pinned on the http-request node's `env` field.
 */
export class EnvironmentValue extends StringBackedValue {
  readonly type = 'environment' as const
}
