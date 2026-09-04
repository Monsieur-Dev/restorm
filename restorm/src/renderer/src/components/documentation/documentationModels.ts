import { createContext, useContext } from 'react'
import type { SecurityScheme } from '../../../../shared/types/apiDocumentation'

/**
 * Set of model names rendered by the surrounding `DocumentationHost`.
 * Cross-reference helpers (`<ModelRefLink>`, schema-cell renderers
 * inside the parameters / responses tables) use this to decide
 * whether a type literal points at a documented model that should
 * become a clickable link, or whether it should render as plain
 * code (for primitives like `string` / `integer`).
 */
export const DocumentationModelsContext = createContext<Set<string>>(new Set())

export function useDocumentedModels(): Set<string> {
  return useContext(DocumentationModelsContext)
}

/**
 * Set of NAMED ENUM names rendered by the surrounding `DocumentationHost`
 * (the enum-shaped schemas surfaced in the Enums section). Cross-reference
 * helpers use this so a type literal that names an enum links to the Enums
 * section rather than the model graph.
 */
export const DocumentationEnumsContext = createContext<Set<string>>(new Set())

export function useDocumentedEnums(): Set<string> {
  return useContext(DocumentationEnumsContext)
}

/**
 * Edit affordances of the surrounding `DocumentationHost`, when its
 * documentation is EDITABLE somewhere else in the app (the design doc
 * viewer: the doc stays the readable view, editing lives in the design
 * cards). Absent callbacks (the default) render no edit chrome — the
 * imported-API doc surfaces stay purely descriptive.
 */
export interface DocumentationEditApi {
  /** Jump to the editable card of the model carrying this name. */
  editModel?: (modelName: string) => void
}

export const DocumentationEditContext = createContext<DocumentationEditApi>({})

export function useDocumentationEdit(): DocumentationEditApi {
  return useContext(DocumentationEditContext)
}

/**
 * Map of named security schemes for the surrounding
 * `DocumentationHost`. The `RouteHeader` consults this so a
 * scheme name on the operation can be rendered with the full
 * scheme metadata (apiKey location, OAuth2 flows + scopes, …).
 */
export const DocumentationSecuritySchemesContext = createContext<Record<string, SecurityScheme>>({})

export function useDocumentedSecuritySchemes(): Record<string, SecurityScheme> {
  return useContext(DocumentationSecuritySchemesContext)
}

/**
 * Pull the model name out of an API schema label.
 *
 * - `Pet`            → `{ ref: 'Pet', isArray: false }`
 * - `array<Pet>`     → `{ ref: 'Pet', isArray: true }`
 * - `Array<Pet>`     → same — case-insensitive
 * - `Pet[]`          → same
 * - `string`/`int`/… → `{ ref: undefined, isArray: false }`
 *
 * The labels returned by the import transformers stick to those
 * shapes; consumers that pass anything else will simply get back
 * `ref: undefined` and render the original string.
 */
export function extractModelRef(label: string): { ref: string | undefined; isArray: boolean } {
  const trimmed = label.trim()
  if (trimmed.length === 0) return { ref: undefined, isArray: false }
  // `Foo[]` / `Foo []`
  const bracket = /^([A-Za-z_$][\w$]*)\s*\[\]$/.exec(trimmed)
  if (bracket) return { ref: bracket[1] ?? undefined, isArray: true }
  // `array<Foo>` / `Array<Foo>`
  const generic = /^[Aa]rray\s*<\s*([A-Za-z_$][\w$]*)\s*>$/.exec(trimmed)
  if (generic) return { ref: generic[1] ?? undefined, isArray: true }
  // Bare `Foo` — treat as a candidate model name (consumers gate on
  // membership in the documented-models set before linking).
  if (/^[A-Za-z_$][\w$]*$/.test(trimmed)) return { ref: trimmed, isArray: false }
  return { ref: undefined, isArray: false }
}
