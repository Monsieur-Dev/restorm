/**
 * Handlebars Helpers Registration (Main Process)
 *
 * Registers all custom Handlebars helpers needed for code snippet templates
 * and variable resolution.
 */

import Handlebars from 'handlebars'
import { registerComparisonHelpers } from './comparison'
import { registerStringHelpers } from './string'
import { registerMathHelpers } from './math'
import { registerArrayHelpers } from './array'
import { registerObjectHelpers } from './object'
import { registerURLHelpers } from './url'
import { registerDateHelpers } from './date'
import { registerMiscHelpers } from './misc'

// Flag to prevent registering helpers multiple times
let helpersRegistered = false

/**
 * Register all Handlebars helpers.
 * Safe to call multiple times - will only register once.
 */
export function registerHandlebarsHelpers(): void {
  if (helpersRegistered) return
  helpersRegistered = true

  registerComparisonHelpers(Handlebars)
  registerStringHelpers(Handlebars)
  registerMathHelpers(Handlebars)
  registerArrayHelpers(Handlebars)
  registerObjectHelpers(Handlebars)
  registerURLHelpers(Handlebars)
  registerDateHelpers(Handlebars)
  registerMiscHelpers(Handlebars)
}
