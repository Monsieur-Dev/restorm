/**
 * OpenAPI 3.2 → ApiDocumentation transformer.
 *
 * OpenAPI 3.2 is a structural SUPERSET of 3.1: same `info` / `servers` /
 * `paths` / `components` / `security` skeleton and the same JSON-Schema
 * 2020-12 dialect for schemas. Its additions are handled where they live
 * rather than by a separate pipeline:
 *
 *  - **`query` HTTP method** and **`additionalOperations`** (custom verbs like
 *    `PURGE` / `LINK`) — enumerated by `enumeratePathItemOperations` in the base
 *    transformer, so both the documentation and the request builder pick them
 *    up with no extra work here.
 *  - **streaming `itemSchema`** on media types — treated as the media type's
 *    schema when a whole-payload `schema` is absent (`mediaTypeSchema`), and
 *    schema-normalised by the shared 3.1 downcast.
 *  - **`$self`** — accepted on the spec type (recorded, not needed for
 *    Restorm's in-document `$ref` resolution).
 *  - **hierarchical tags** (`tag.parent` / `tag.kind`) — intentionally NOT
 *    modelled: Restorm's documentation groups are flat, and adding a parent
 *    axis would change the persisted shape and the doc UI. A 3.2 spec that
 *    uses them still imports; the hierarchy is simply flattened to the tag
 *    names, exactly as 3.0 / 3.1 already do.
 *
 * So the 3.2 path reuses the 3.1 shim verbatim: it performs the 3.1 schema
 * downcast (now 3.2-aware — it also walks `query` / `additionalOperations` and
 * `itemSchema`) and hands the result to the 3.0 transformer.
 */

import type { ApiDocumentation } from '../../../../shared/types/apiDocumentation'
import { openapi31ToApiDocumentation, type OAS31Spec } from './openapi31ToApiDocumentation'
import type { OpenAPI3TransformOptions } from './openapi3ToApiDocumentation'

/** OpenAPI 3.2 spec shape — a structural superset of 3.1 for the metadata
 * transformer's purposes. The 3.2-only additions (`additionalOperations`,
 * `query`, `itemSchema`, `$self`) are declared on the shared OAS3 types. */
export type OAS32Spec = OAS31Spec

/** Transform a parsed OpenAPI 3.2 spec into `ApiDocumentation`. */
export function openapi32ToApiDocumentation(
  spec: OAS32Spec,
  options: OpenAPI3TransformOptions = {}
): ApiDocumentation {
  return openapi31ToApiDocumentation(spec, options)
}
