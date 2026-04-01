/**
 * Shared Handlebars-based template resolution for request services.
 */

import Handlebars from 'handlebars'
import { registerHandlebarsHelpers } from '../../utils/handlebarsHelpers'

// Ensure helpers are registered once
registerHandlebarsHelpers()

/**
 * Resolve Handlebars template expressions in a string using the given variable context.
 * Returns the raw value if no template expressions found or on error.
 */
export function resolveTemplate(template: string, context: Record<string, unknown>): string {
  if (!template.includes('{{')) return template
  try {
    const compiled = Handlebars.compile(template, { noEscape: true })
    return compiled(context)
  } catch {
    return template
  }
}
