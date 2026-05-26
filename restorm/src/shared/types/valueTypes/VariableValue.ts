import { StringBackedValue } from './BaseValueType'

/**
 * A reference to a scenario variable by name (e.g. one declared by a
 * `setVariable` node or an input/param). Stored as the bare variable name; the
 * runtime resolves it to that variable's current value when a node reads it.
 *
 * Scenario-only: it surfaces in the value selector's "Variables" menu, which is
 * populated from the variables in scope — so it never appears in contexts
 * without a scenario (e.g. a request's KV table).
 */
export class VariableValue extends StringBackedValue {
  readonly type = 'variable' as const
}
