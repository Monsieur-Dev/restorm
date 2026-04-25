/**
 * Shared helpers for turning a user-filled parameter list into the
 * dispatchable payload shape: a JSON body for v4 actions, inlined
 * function-call arguments for v4 functions.
 *
 * These mirror the CSDL type → wire-format conversion rules from the
 * OData v4 spec (quoting strings/guids, bare numerics, enum prefix,
 * `true`/`false` for booleans). Unknown types fall back to string
 * quoting so at least the invocation is well-formed.
 */

import type { ODataOperationParameterSpec } from '../types/requests/ODataRequest'

/** Serialize a single parameter value for URL-inlining. */
export function serializeFunctionArgValue(
  type: string,
  value: string | undefined
): string {
  if (value === undefined || value === '') return 'null'
  if (isNumericType(type)) return value
  if (isBooleanType(type)) return value.toLowerCase() === 'true' ? 'true' : 'false'
  if (isGuidType(type)) return value
  // Enum: OData v4 wants `Namespace.EnumName'Value'`. We don't have
  // the qualified name in the value field, so emit just the literal
  // — users can prefix it in the value box if they need to.
  if (isStringType(type)) return `'${escapeSingleQuote(value)}'`
  return `'${escapeSingleQuote(value)}'`
}

/** Build the inlined `(param1=...,param2=...)` string from the non-
 * binding parameters of a function. Binding params are filtered
 * upstream by the caller (the UI hides them). */
export function buildFunctionInlinedArgs(
  params: readonly ODataOperationParameterSpec[]
): string {
  const parts = params
    .filter((p) => !p.isBinding)
    .map((p) => `${p.name}=${serializeFunctionArgValue(p.type, p.value)}`)
  if (parts.length === 0) return ''
  return `(${parts.join(',')})`
}

/** Build a JSON body for a v4 action invocation. Binding params are
 * covered by the URL, not the payload, so they're filtered out.
 * Values are parsed per CSDL type so the server sees a number, a
 * boolean, or a string as appropriate. Missing values are omitted
 * rather than set to `null` so the server's own defaults can kick
 * in. */
export function buildActionBodyObject(
  params: readonly ODataOperationParameterSpec[]
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const p of params) {
    if (p.isBinding) continue
    if (p.value === undefined || p.value === '') continue
    out[p.name] = parseParameterValue(p.type, p.value)
  }
  return out
}

function parseParameterValue(type: string, raw: string): unknown {
  if (isBooleanType(type)) return raw.toLowerCase() === 'true'
  if (isNumericType(type)) {
    const n = Number(raw)
    if (!Number.isNaN(n)) return n
    return raw
  }
  return raw
}

function isNumericType(type: string): boolean {
  return /^Edm\.(Int16|Int32|Int64|Byte|SByte|Decimal|Single|Double)$/.test(type)
}
function isBooleanType(type: string): boolean {
  return type === 'Edm.Boolean'
}
function isGuidType(type: string): boolean {
  return type === 'Edm.Guid'
}
function isStringType(type: string): boolean {
  return type === 'Edm.String'
}
function escapeSingleQuote(v: string): string {
  return v.replace(/'/g, "''")
}
