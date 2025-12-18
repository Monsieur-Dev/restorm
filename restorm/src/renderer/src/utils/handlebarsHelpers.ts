import Handlebars from 'handlebars'

// Register custom Handlebars helpers

// Equality check helper
Handlebars.registerHelper('eq', function (a: unknown, b: unknown): boolean {
  return a === b
})

// Not equal helper
Handlebars.registerHelper('neq', function (a: unknown, b: unknown): boolean {
  return a !== b
})

// ifEquals block helper
Handlebars.registerHelper('ifEquals', function (this: unknown, a: unknown, b: unknown, options: Handlebars.HelperOptions) {
  if (a === b) {
    return options.fn(this)
  }
  return options.inverse(this)
})

// String manipulation helpers
Handlebars.registerHelper('lowercase', function (str: unknown): string {
  return typeof str === 'string' ? str.toLowerCase() : ''
})

Handlebars.registerHelper('uppercase', function (str: unknown): string {
  return typeof str === 'string' ? str.toUpperCase() : ''
})

Handlebars.registerHelper('snakeCase', function (str: unknown): string {
  if (typeof str !== 'string') return ''
  return str.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()
})

export { Handlebars }
