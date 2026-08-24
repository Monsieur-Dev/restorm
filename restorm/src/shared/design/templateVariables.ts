/**
 * User-declared code-generation variables — the declarative half of the
 * "custom template variables" feature. A template DECLARES variables in its
 * manifest (name + scope + type + default); the user fills each VALUE as a
 * Handlebars expression in Restorm; at generate time the expression is
 * evaluated PER ENTITY against that entity's codegen context, coerced to the
 * declared type, and injected into `ctx.*.vars.<name>` for the template to read.
 *
 * This module holds the shared TYPES + the pure cascade / coercion resolver.
 * The Handlebars evaluation itself is INJECTED (`evaluate`) so this file stays
 * free of the engine and unit-testable; the main process passes a
 * Handlebars-backed evaluator.
 */

/** Where a variable is defined and evaluated. `project` → once, into
 * `ctx.design.vars`; `model` → per model, into `ctx.models[].vars`; `route` →
 * per route, into `ctx.groups[].routes[].vars`. (`enum` scope is deferred.) */
export type TemplateVariableScope = 'project' | 'model' | 'route'
/** Drives value coercion + the value editor's validation. */
export type TemplateVariableType = 'string' | 'boolean' | 'number' | 'enum'

/** One user variable a template declares. */
export interface TemplateVariableDecl {
  name: string
  scope: TemplateVariableScope
  type: TemplateVariableType
  /** Allowed values when `type` is `enum`. */
  options?: string[]
  /** Fallback value (a literal, or a Handlebars expression) when neither a
   * global nor a per-entity value is set. */
  default?: string
  description?: string
}

/** Global variable values a design stores for ONE template, one map per scope
 * (varName → Handlebars expression). These are the "apply to all models / all
 * routes" defaults; a per-entity value overrides them. */
export interface TemplateVarValues {
  project?: Record<string, string>
  model?: Record<string, string>
  route?: Record<string, string>
}

/** A per-variable resolution failure — surfaced to the user, never silent. */
export interface CodegenVarError {
  scope: TemplateVariableScope
  name: string
  /** Human label of the entity being resolved (model/route name), when scoped. */
  entity?: string
  message: string
}

export interface ResolveScopeResult {
  values: Record<string, unknown>
  errors: CodegenVarError[]
}

/** First non-empty (trimmed) candidate, or undefined — the cascade picker.
 * An empty string means "inherit from the next level", per the UX contract. */
function firstDefined(...candidates: (string | undefined)[]): string | undefined {
  for (const c of candidates) {
    if (c !== undefined && c.trim() !== '') return c
  }
  return undefined
}

/** Coerce an evaluated string to the declared type. Throws on a bad value (the
 * caller turns the message into a {@link CodegenVarError}). */
function coerce(raw: string, decl: TemplateVariableDecl): unknown {
  switch (decl.type) {
    case 'string':
      return raw
    case 'boolean': {
      const v = raw.trim().toLowerCase()
      if (['true', '1', 'yes', 'on'].includes(v)) return true
      if (['false', '0', 'no', 'off', ''].includes(v)) return false
      throw new Error(`expected a boolean, got "${raw}"`)
    }
    case 'number': {
      const n = Number(raw.trim())
      if (Number.isNaN(n)) throw new Error(`expected a number, got "${raw}"`)
      return n
    }
    case 'enum': {
      const options = decl.options ?? []
      if (!options.includes(raw)) throw new Error(`"${raw}" is not one of ${options.join(', ')}`)
      return raw
    }
  }
}

/**
 * Resolve every declared variable of one scope into concrete values for a
 * single entity. For each variable: pick the finest non-empty expression
 * (per-entity override › global › manifest default), evaluate it against
 * `evalContext`, coerce to the declared type. A variable with no value at any
 * level is simply absent. Evaluation / coercion failures are collected as
 * errors (and the variable is dropped), never thrown.
 */
export function resolveScopeVars(params: {
  decls: readonly TemplateVariableDecl[]
  scope: TemplateVariableScope
  global?: Record<string, string> | undefined
  overrides?: Record<string, string> | undefined
  evalContext: Record<string, unknown>
  entity?: string
  evaluate: (expression: string, context: Record<string, unknown>) => string
}): ResolveScopeResult {
  const { decls, scope, global, overrides, evalContext, entity, evaluate } = params
  const values: Record<string, unknown> = {}
  const errors: CodegenVarError[] = []
  for (const decl of decls) {
    if (decl.scope !== scope) continue
    const expression = firstDefined(overrides?.[decl.name], global?.[decl.name], decl.default)
    if (expression === undefined) continue
    let raw: string
    try {
      raw = evaluate(expression, evalContext)
    } catch (err) {
      errors.push({ scope, name: decl.name, ...(entity !== undefined ? { entity } : {}), message: err instanceof Error ? err.message : String(err) })
      continue
    }
    try {
      values[decl.name] = coerce(raw, decl)
    } catch (err) {
      errors.push({ scope, name: decl.name, ...(entity !== undefined ? { entity } : {}), message: err instanceof Error ? err.message : String(err) })
    }
  }
  return { values, errors }
}
