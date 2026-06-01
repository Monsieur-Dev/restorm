/**
 * An `input` node declares one or more named run-parameters (like an `object`
 * node declares properties). Each carries a name, a typed default, and a
 * `required` flag (mandatory on a parent `runScenario`'s derived `param:<name>`
 * port). The node emits one object `{ name: value, … }` on its single `value`
 * output; a parent exposes one `param:<name>` port PER param.
 *
 * Persisted as `config.params: InputParam[]`. {@link readInputParams} also
 * migrates the legacy single-param shape (`config.name` / `config.valueType` /
 * `config.required`) on read, so old scenarios keep working without a disk
 * rewrite.
 */
export interface InputParam {
  id: string
  name: string
  /** Persisted typed default (`{ type, value }` POJO) — resolved by
   * `concreteValue` / `normalizeValueType`. */
  valueType?: unknown
  required?: boolean
}

/** Stable id for the default (not-yet-persisted) first param row shown on an
 * empty input node, mirroring the object node's default row. */
export const INPUT_DEFAULT_PARAM_ID = 'input-default-param'

function isInputParam(p: unknown): p is InputParam {
  return typeof p === 'object' && p !== null
    && typeof (p as { id?: unknown }).id === 'string'
    && typeof (p as { name?: unknown }).name === 'string'
}

/** The input node's params, migrating the legacy single-param config on read. */
export function readInputParams(config: Record<string, unknown>): InputParam[] {
  const raw = config['params']
  if (Array.isArray(raw)) return raw.filter(isInputParam)
  // Legacy single-param input: { name, valueType, required }.
  const hasLegacy = typeof config['name'] === 'string'
    || config['valueType'] !== undefined
    || config['required'] !== undefined
  if (hasLegacy) {
    return [{
      id: 'param-legacy',
      name: typeof config['name'] === 'string' ? config['name'] : '',
      valueType: config['valueType'],
      required: config['required'] === true
    }]
  }
  return []
}
