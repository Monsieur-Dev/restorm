/**
 * OpenAPI 3.1 → ApiDocumentation transformer.
 *
 * 3.1 keeps the structural skeleton of 3.0 — `info`, `servers`, `paths`,
 * `components`, `security` — and changes how schemas express
 * nullability/examples plus introduces a top-level `webhooks` map. Rather
 * than re-implement the bulk of the transformer, this shim:
 *
 *  1. Normalises 3.1-specific schema deltas (`type: ['string', 'null']` →
 *     `nullable: true`, `examples` plural → `example` singular) **in place**
 *     on a defensive deep clone of the input.
 *  2. Hands the normalised spec to the 3.0 transformer.
 *  3. Returns its result with `sourceType: 'openapi'` (already set) — the
 *     downstream consumers don't need to distinguish 3.0 vs 3.1.
 *
 * The 3.0 transformer already passes `webhooks` through (when present), so
 * the only 3.1-only addition handled here is the schema delta normalisation.
 */

import type { ApiDocumentation } from '../../../../shared/types/apiDocumentation'
import {
  openapi3ToApiDocumentation,
  type OAS3Spec,
  type OpenAPI3TransformOptions
} from './openapi3ToApiDocumentation'
import type { CommonSchema } from './_shared'

/** OpenAPI 3.1 spec shape — strict superset of 3.0 for the metadata
 * transformer's purposes. The full 3.1 shape (webhooks, JSON Schema 2020-12
 * keywords, `$id`, `$schema`) is largely absorbed by the existing OAS3 types
 * because they overlap; the shim is mainly about schema-level normalisation. */
export interface OAS31Spec extends Omit<OAS3Spec, 'openapi'> {
  openapi: string
  /** SPDX license identifier — 3.1-only addition under `info.license`. */
}

/**
 * Convert a 3.1 schema to its 3.0 equivalent for the metadata layer:
 *  - `type: ['string', 'null']` → `type: 'string'` + `nullable: true`
 *  - `examples: [v]` → `example: v` (3.1 deprecates singular)
 *
 * The transformation is local — every nested schema reachable through
 * `properties` / `items` / `oneOf` / `anyOf` / `allOf` /
 * `additionalProperties` is rewritten the same way. Returns a new tree;
 * does not mutate the input.
 */
export function normalizeSchema31To30(schema: CommonSchema): CommonSchema {
  const out: CommonSchema = { ...schema }

  // type: ["string", "null"] → type: "string" + nullable: true
  if (Array.isArray(out.type)) {
    const hasNull = out.type.includes('null')
    const nonNull = out.type.filter((t) => t !== 'null')
    if (hasNull && nonNull.length === 1) {
      out.type = nonNull[0]
      out.nullable = true
    } else if (nonNull.length === 1 && !hasNull) {
      out.type = nonNull[0]
    }
    // Else: leave the array alone — `_shared`'s schemaTypeLabel handles arrays.
  }

  // Numeric exclusive bounds (JSON Schema 2020-12) → the Swagger-2
  // boolean-plus-bound spelling the doc layer stores. Makes the 3.1
  // emit→re-import loop STRICT: the emitter converts
  // `{minimum: n, exclusiveMinimum: true}` to `{exclusiveMinimum: n}`,
  // and this walks it back.
  if (typeof out.exclusiveMinimum === 'number' && out.minimum === undefined) {
    out.minimum = out.exclusiveMinimum
    out.exclusiveMinimum = true
  }
  if (typeof out.exclusiveMaximum === 'number' && out.maximum === undefined) {
    out.maximum = out.exclusiveMaximum
    out.exclusiveMaximum = true
  }

  // examples plural → example singular (when no example was already set).
  if (out.examples !== undefined && out.example === undefined) {
    if (Array.isArray(out.examples) && out.examples.length > 0) {
      out.example = out.examples[0]
    } else if (typeof out.examples === 'object') {
      const firstValue = Object.values(out.examples)[0]
      if (firstValue !== undefined) {
        // 3.1 named-examples style: `{ key: { value: ... } }`.
        out.example = (firstValue as { value?: unknown }).value ?? firstValue
      }
    }
  }

  if (out.items) out.items = normalizeSchema31To30(out.items)
  if (out.additionalProperties && typeof out.additionalProperties === 'object') {
    out.additionalProperties = normalizeSchema31To30(out.additionalProperties)
  }
  if (out.properties) {
    const nextProps: Record<string, CommonSchema> = {}
    for (const [k, v] of Object.entries(out.properties)) nextProps[k] = normalizeSchema31To30(v)
    out.properties = nextProps
  }
  for (const key of ['oneOf', 'anyOf', 'allOf'] as const) {
    const branches = out[key]
    if (Array.isArray(branches)) out[key] = branches.map(normalizeSchema31To30)
  }
  return out
}

/** Walk a parsed 3.1 spec and rewrite every reachable schema with
 * `normalizeSchema31To30`. Returns a fresh spec; does not mutate the input. */
function downcastSpec31To30(spec: OAS31Spec): OAS3Spec {
  const next: OAS3Spec = JSON.parse(JSON.stringify(spec)) as OAS3Spec

  // components.schemas — narrow once instead of using a non-null assertion.
  if (next.components?.schemas) {
    const nextSchemas: Record<string, CommonSchema> = {}
    for (const [k, v] of Object.entries(next.components.schemas)) {
      nextSchemas[k] = normalizeSchema31To30(v)
    }
    next.components.schemas = nextSchemas
  }

  // operations' parameters/requestBody/responses (in `paths` and `webhooks`).
  const visitPathItems = (items: Record<string, unknown> | undefined): void => {
    if (!items) return
    for (const pathItem of Object.values(items)) {
      if (!pathItem || typeof pathItem !== 'object') continue
      walkPathItem(pathItem as Record<string, unknown>)
    }
  }

  const walkSchemaInline = (value: unknown): unknown => {
    if (!value || typeof value !== 'object') return value
    if ('$ref' in (value as Record<string, unknown>)) return value
    return normalizeSchema31To30(value as CommonSchema)
  }

  const walkOperation = (op: Record<string, unknown> | undefined): void => {
    if (!op || typeof op !== 'object') return
    const params = op.parameters as Record<string, unknown>[] | undefined
    if (Array.isArray(params)) {
      for (const p of params) {
        if (p.schema) p.schema = walkSchemaInline(p.schema)
      }
    }
    const body = op.requestBody as Record<string, unknown> | undefined
    if (body && typeof body === 'object') {
      const content = body.content as Record<string, Record<string, unknown>> | undefined
      if (content) {
        for (const media of Object.values(content)) {
          // OpenAPI 3.2 streaming media types use `itemSchema`; normalise both.
          if (media.schema) media.schema = walkSchemaInline(media.schema)
          if (media.itemSchema) media.itemSchema = walkSchemaInline(media.itemSchema)
        }
      }
    }
    const responses = op.responses as Record<string, Record<string, unknown>> | undefined
    if (responses) {
      for (const resp of Object.values(responses)) {
        const content = resp.content as Record<string, Record<string, unknown>> | undefined
        if (!content) continue
        for (const media of Object.values(content)) {
          if (media.schema) media.schema = walkSchemaInline(media.schema)
          if (media.itemSchema) media.itemSchema = walkSchemaInline(media.itemSchema)
        }
      }
    }
  }

  const walkPathItem = (pathItem: Record<string, unknown>): void => {
    // 3.0/3.1 fixed methods + the 3.2 `query` method.
    for (const method of ['get', 'post', 'put', 'delete', 'patch', 'head', 'options', 'query'] as const) {
      walkOperation(pathItem[method] as Record<string, unknown> | undefined)
    }
    // OpenAPI 3.2 `additionalOperations` — custom-verb operations.
    const additional = pathItem.additionalOperations as Record<string, unknown> | undefined
    if (additional && typeof additional === 'object') {
      for (const op of Object.values(additional)) walkOperation(op as Record<string, unknown> | undefined)
    }
    // Path-item-scoped parameters live alongside operations.
    const sharedParams = pathItem.parameters as Record<string, unknown>[] | undefined
    if (Array.isArray(sharedParams)) {
      for (const p of sharedParams) if (p.schema) p.schema = walkSchemaInline(p.schema)
    }
  }

  visitPathItems(next.paths as unknown as Record<string, unknown> | undefined)
  visitPathItems(next.webhooks as unknown as Record<string, unknown> | undefined)

  return next
}

/** Transform a parsed OpenAPI 3.1 spec into `ApiDocumentation`. */
export function openapi31ToApiDocumentation(
  spec: OAS31Spec,
  options: OpenAPI3TransformOptions = {}
): ApiDocumentation {
  const downcast = downcastSpec31To30(spec)
  return openapi3ToApiDocumentation(downcast, options)
}
