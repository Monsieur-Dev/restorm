/**
 * Flatten a codegen eval-context slice (`{design, model?}` / `{design, group,
 * route}`) into the dotted-path {@link VariableDefinition}[] the Handlebars
 * value editor offers as contextual variables — mirroring EXACTLY what a
 * variable's expression is evaluated against at generate time
 * (`codegenEvalContext`), so autocomplete never suggests a path the template
 * couldn't read.
 */

import type { VariableDefinition } from 'electron-core-ui/renderer'

/** Recursively flatten primitive leaves to `a.b.c` (arrays → `a.0`, `a.1`). */
export function flattenToVariableDefinitions(context: Record<string, unknown>): VariableDefinition[] {
  const out: VariableDefinition[] = []
  const walk = (value: unknown, path: string): void => {
    if (value === null || value === undefined) return
    if (Array.isArray(value)) {
      value.forEach((v, i) => { walk(v, `${path}.${i}`) })
      return
    }
    if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        walk(v, path === '' ? k : `${path}.${k}`)
      }
      return
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out.push({ name: path, value: String(value) })
    }
  }
  walk(context, '')
  return out
}
