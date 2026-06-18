/**
 * Shared Handlebars-based template resolution for request services.
 */

import Handlebars from 'handlebars'
import { logger } from 'electron-core-ui/main'
import { registerHandlebarsHelpers } from '../../../shared/utils/handlebars/registerAll'

// Ensure helpers are registered once
registerHandlebarsHelpers()

const FORBIDDEN_CONTEXT_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

/**
 * Copy the variable context onto a null-prototype object, dropping any
 * prototype-polluting keys. A templated value resolved into Handlebars
 * must not be able to reach Object.prototype (e.g. `{{constructor}}`),
 * and a context built from untrusted env data must not carry a
 * `__proto__` own-key.
 */
function toSafeContext(context: Record<string, unknown>): Record<string, unknown> {
  const safe = Object.create(null) as Record<string, unknown>
  for (const key of Object.keys(context)) {
    if (FORBIDDEN_CONTEXT_KEYS.has(key)) continue
    safe[key] = context[key]
  }
  return safe
}

/**
 * Resolve Handlebars template expressions in a string using the given variable context.
 * Returns the raw value if no template expressions found. On a compile/render
 * error the raw template is returned (so a bad expression doesn't abort the
 * whole request) but the error is LOGGED rather than silently swallowed.
 */
export function resolveTemplate(template: string, context: Record<string, unknown>): string {
  if (!template.includes('{{')) return template
  try {
    const compiled = Handlebars.compile(template, { noEscape: true })
    return compiled(toSafeContext(context))
  } catch (error) {
    logger.warn('[resolveTemplate] template resolution failed; sending raw template', {
      error: error instanceof Error ? error.message : String(error)
    })
    return template
  }
}
