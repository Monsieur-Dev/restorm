/**
 * Coerce a headless CLI `--param name=value` (always a raw string from argv)
 * into the concrete runtime value the target `input` param expects, driven by
 * that param's declared `valueType`. Without this a numeric input would receive
 * the string `"5"`, a boolean the string `"true"`, an enum the wrong-cased name,
 * etc. — diverging from a UI / MCP run (which produces real typed values).
 *
 * The matrix, by target type:
 * - number / boolean: parsed via the scenario `cast` core (`castValue`) so the
 *   spellings + errors match the `cast` node (bool: true/1/yes/on, false/0/no/off).
 * - datetime: string→date, falling back to a bare epoch (seconds/millis); emitted
 *   as the canonical ISO string (a datetime's runtime form).
 * - list: JSON (e.g. Ids=[1,2,3]).
 * - enum / enumList: the value(s) (an enum's value IS the string); comma-separated
 *   for the list form; validated against the enum's allowed set when known.
 * - customList / customListMulti: the LABEL is resolved to its substituted VALUE
 *   (e.g. Rouge → FF0000) via the installed resolver; comma-separated for multi.
 * - environment: a name OR id resolved to the environment id (an ambiguous name
 *   throws), then to its `{ name, variables }` value.
 * - every other textual type (string / color / expression / …): the raw string.
 *
 * An impossible cast THROWS (surfaced as a clear CLI error + a non-zero exit),
 * never a silent wrong value.
 */
import { castValue } from './scenarioCast'
import { concreteValue } from './utils/scenarioStaticPreview'

/** Returns the allowed values of an enum definition, or undefined when unknown
 * (validation is then skipped). Installed from the loaded project. */
let enumValuesResolver: ((enumDefinitionId: string) => string[] | undefined) | null = null
export function setEnumValuesResolver(fn: ((enumDefinitionId: string) => string[] | undefined) | null): void {
  enumValuesResolver = fn
}

/** Resolves an environment NAME or id to its id — THROWS on an ambiguous name or
 * an unknown token. Installed from the loaded project. */
let environmentIdResolver: ((token: string) => string) | null = null
export function setEnvironmentIdResolver(fn: ((token: string) => string) | null): void {
  environmentIdResolver = fn
}

/** Split a comma-separated multi value into trimmed, non-empty items. */
function splitMulti(raw: string): string[] {
  return raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
}

function validateEnum(raw: string, enumDefinitionId: unknown): void {
  if (typeof enumDefinitionId !== 'string' || enumValuesResolver === null) return
  const values = enumValuesResolver(enumDefinitionId)
  if (values !== undefined && !values.includes(raw)) {
    throw new Error(`--param value "${raw}" is not an allowed enum value (expected one of: ${values.join(', ')})`)
  }
}

export function coerceCliParamValue(raw: string, valueType: unknown): unknown {
  const vt = (valueType as { type?: unknown; enumDefinitionId?: unknown; listId?: unknown } | null | undefined) ?? undefined
  switch (vt?.type) {
    case 'numeric':
      return castValue(raw, 'number')
    case 'boolean':
      return castValue(raw, 'boolean')
    case 'datetime':
      // string→date, with a bare-epoch (seconds/millis) fallback; canonical ISO.
      return (castValue(raw, 'date') as Date).toISOString()
    case 'null':
      return null
    case 'list': {
      // A list param is passed as JSON, e.g. --param Ids='[1,2,3]'.
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        throw new Error(`--param list value is not valid JSON: ${raw}`)
      }
      if (!Array.isArray(parsed)) {
        throw new Error(`--param list value must be a JSON array, got: ${raw}`)
      }
      return parsed
    }
    case 'enum':
      validateEnum(raw, vt.enumDefinitionId)
      return raw
    case 'enumList': {
      const items = splitMulti(raw)
      for (const it of items) validateEnum(it, vt.enumDefinitionId)
      return items
    }
    case 'customList':
      // The resolver maps the label to its value (Rouge → FF0000); falls back to
      // the label when the list/label is unknown (matches `concreteValue`).
      return concreteValue({ type: 'customList', listId: vt.listId, label: raw })
    case 'customListMulti':
      return splitMulti(raw).map((label) => concreteValue({ type: 'customList', listId: vt.listId, label }))
    case 'environment': {
      // Accept a name OR an id; resolve to the id (ambiguous name → throw), then
      // to the environment's `{ name, variables }` value.
      const envId = environmentIdResolver !== null ? environmentIdResolver(raw) : raw
      return concreteValue({ type: 'environment', value: envId })
    }
    // string | color | expression | password | variable | undefined → the raw
    // string IS the value (concreteValue renders these from their string form).
    default:
      return raw
  }
}
