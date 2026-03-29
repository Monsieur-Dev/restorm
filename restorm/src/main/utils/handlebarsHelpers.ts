/**
 * Handlebars Helpers Registration (Main Process)
 *
 * Registers all custom Handlebars helpers needed for code snippet templates
 * and variable resolution.
 */

import Handlebars from 'handlebars'
import { registerComparisonHelpers } from './helpers/comparison'
import { registerStringHelpers } from './helpers/string'
import { registerMathHelpers } from './helpers/math'
import { registerArrayHelpers } from './helpers/array'
import { registerObjectHelpers } from './helpers/object'
import { registerURLHelpers } from './helpers/url'
import { registerDateHelpers } from './helpers/date'
import { registerMiscHelpers } from './helpers/misc'

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
