import Ajv from 'ajv'

/**
 * Validate a value against a JSON Schema string via ajv (the standard, supports
 * draft-07 / 2019-09 / 2020-12). Shared by the `schema` node executor AND its
 * inspector static preview, so the two can't drift. A malformed schema (non-JSON,
 * or a schema ajv rejects) THROWS — the executor routes that to the `error` port,
 * the preview catches it. A value mismatch is NOT an error: it returns `{ valid:
 * false, errors }` so the node can branch on `valid` / `invalid`.
 */
export interface SchemaValidationResult {
  valid: boolean
  errors: string[]
}

export function validateAgainstSchema(value: unknown, schemaText: string): SchemaValidationResult {
  let schema: unknown
  try {
    schema = JSON.parse(schemaText)
  } catch {
    throw new Error('schema: the JSON Schema is not valid JSON')
  }
  const ajv = new Ajv({ allErrors: true, strict: false })
  const validate = ajv.compile(schema as object) // throws on an invalid schema → caught upstream
  const ok = validate(value)
  const errors = ok
    ? []
    : (validate.errors ?? []).map((e) => `${e.instancePath === '' ? '/' : e.instancePath} ${e.message ?? 'invalid'}`.trim())
  return { valid: ok, errors }
}
