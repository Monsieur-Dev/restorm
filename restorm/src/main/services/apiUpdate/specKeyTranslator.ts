import type { ImportSourceType } from '../../../shared/types/baseTypes'
import type { NormalizedSpec } from '../import/idempotent/types'

/**
 * Bridge between the two natural-key schemes the codebase carries:
 *
 * - **Pipeline keys**: `METHOD path`, e.g. `GET /pet/{id}`, produced
 *   by every `ImportAdapter.extractNormalizedSpec`. Used for matching
 *   `importOrigin.naturalKey` on existing requests.
 * - **Import-selection keys**: `request:http:METHOD url`, e.g.
 *   `request:http:GET {{baseUrl}}/pet/{{id}}`, produced by
 *   `importNaturalKeyForRequest`. Used as the user-facing
 *   selection-set key in the import / refresh modal's tree.
 *
 * The two schemes don't match: the pipeline operates on raw spec
 * paths, the modal operates on the post-import handlebars URL with
 * `{{baseUrl}}` prefix and `{{paramName}}` placeholders. The apply
 * pass needs to translate the user's modal-side selection into spec
 * keys before filtering operations. This module owns that
 * translation so the orchestrator stays pure.
 */

function pipelinePathToImportPath(specPath: string): string {
  // The Swagger / OpenAPI import services rewrite `/pets/{id}` into
  // `{{baseUrl}}/pets/{{id}}` (every `{x}` placeholder becomes
  // `{{x}}`, plus the `{{baseUrl}}` prefix). Mirror that exact rule
  // here so the lookup against the snapshot key matches.
  return `{{baseUrl}}${specPath.replace(/\{(\w+)\}/g, '{{$1}}')}`
}

/**
 * Translate one spec-side naturalKey into the import-selection
 * snapshot key scheme. Returns the input unchanged when the format
 * isn't HTTP-like (GraphQL / gRPC / etc. snapshot keys use the
 * operation `name` directly, which the pipeline naturalKey doesn't
 * necessarily expose).
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
