import type { ImportSourceType } from '../../../shared/types/baseTypes'
import type { NormalizedSpec } from '../import/idempotent/types'

/**
 * Bridge between the two natural-key schemes the codebase carries:
 *
 * - **Pipeline keys** (OYO-168): `METHOD path`, e.g. `GET /pet/{id}`,
 *   produced by every `ImportAdapter.extractNormalizedSpec`. Used for
 *   matching `importOrigin.naturalKey` on existing requests.
 * - **Import-selection keys** (OYO-257): `request:http:METHOD url`,
 *   e.g. `request:http:GET {{baseUrl}}/pet/{{id}}`, produced by
 *   `importNaturalKeyForRequest`. Used for the
 *   `ImportSelectionSnapshot.imported` / `.skipped` arrays the
 *   selective-import wizard persists.
 *
 * The two schemes don't match: the pipeline operates on raw spec
 * paths, the snapshot operates on the post-import handlebars URL with
 * `{{baseUrl}}` prefix and `{{paramName}}` placeholders. The refresh
 * wizard needs a uniform key for its rows + the apply filter (it uses
 * pipeline keys throughout); only the snapshot membership lookup
 * needs the OYO-257 form. This module owns that translation so the
 * resolver stays pure.
 */

function pipelinePathToImportPath(specPath: string): string {
  // The Swagger / OpenAPI import services rewrite `/pets/{id}` into
  // `{{baseUrl}}/pets/{{id}}` (every `{x}` placeholder becomes
  // `{{x}}`, plus the `{{baseUrl}}` prefix). Mirror that exact rule
  // here so the lookup against the snapshot key matches.
  return `{{baseUrl}}${specPath.replace(/\{(\w+)\}/g, '{{$1}}')}`
}

/**
 * Translate one spec-side naturalKey into the OYO-257 snapshot key
 * scheme. Returns the input unchanged when the format isn't HTTP-like
 * (GraphQL / gRPC / etc. snapshot keys use the operation `name`
 * directly, which the pipeline naturalKey doesn't necessarily expose).
 */
export function specKeyToImportSelectionKey(
  specKey: string,
  importSource: ImportSourceType,
  _spec: NormalizedSpec
): string {
  if (importSource !== 'swagger' && importSource !== 'openapi') return specKey
  // Match the pipeline format `METHOD path`.
  const match = /^([A-Z]+) (.+)$/.exec(specKey)
  if (!match) return specKey
  const method = match[1]
  const path = match[2]
  if (!method || !path) return specKey
  return `request:http:${method} ${pipelinePathToImportPath(path)}`
}
