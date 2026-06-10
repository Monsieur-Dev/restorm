import type Handlebars from 'handlebars'

export function registerComparisonHelpers(hbs: typeof Handlebars): void {
  hbs.registerHelper('eq', function (a: unknown, b: unknown): boolean {
    return a === b
  })

  hbs.registerHelper('ne', function (a: unknown, b: unknown): boolean {
    return a !== b
  })

  hbs.registerHelper('neq', function (a: unknown, b: unknown): boolean {
    return a !== b
  })

  hbs.registerHelper('lt', function (a: unknown, b: unknown): boolean {
    return Number(a) < Number(b)
  })

  hbs.registerHelper('lte', function (a: unknown, b: unknown): boolean {
    return Number(a) <= Number(b)
  })

  hbs.registerHelper('gt', function (a: unknown, b: unknown): boolean {
    return Number(a) > Number(b)
  })

  hbs.registerHelper('gte', function (a: unknown, b: unknown): boolean {
    return Number(a) >= Number(b)
  })

  hbs.registerHelper('and', function (this: unknown, ...args: unknown[]): string {
    const options = args.pop() as Handlebars.HelperOptions
    return args.every(Boolean) ? options.fn(this) : options.inverse(this)
  })

  hbs.registerHelper('or', function (this: unknown, ...args: unknown[]): string {
    const options = args.pop() as Handlebars.HelperOptions
    return args.some(Boolean) ? options.fn(this) : options.inverse(this)
  })

  hbs.registerHelper('not', function (value: unknown): boolean {
    return !value
  })

  hbs.registerHelper('ifEquals', function (this: unknown, a: unknown, b: unknown, options: Handlebars.HelperOptions) {
    return a === b ? options.fn(this) : options.inverse(this)
  })

  hbs.registerHelper('is', function (this: unknown, a: unknown, b: unknown, options: Handlebars.HelperOptions) {
    return String(a) === String(b) ? options.fn(this) : options.inverse(this)
  })

  hbs.registerHelper('isnt', function (this: unknown, a: unknown, b: unknown, options: Handlebars.HelperOptions) {
    return String(a) !== String(b) ? options.fn(this) : options.inverse(this)
  })

  hbs.registerHelper('default', function (value: unknown, defaultValue: unknown): unknown {
    return value ?? defaultValue
  })

  hbs.registerHelper('compare', function (this: unknown, a: unknown, operator: string, b: unknown, options: Handlebars.HelperOptions) {
    let result = false
    switch (operator) {
      case '==': result = String(a) === String(b); break
      case '===': result = a === b; break
      case '!=': result = String(a) !== String(b); break
      case '!==': result = a !== b; break
      case '<': result = Number(a) < Number(b); break
      case '<=': result = Number(a) <= Number(b); break
      case '>': result = Number(a) > Number(b); break
      case '>=': result = Number(a) >= Number(b); break
    }
    return result ? options.fn(this) : options.inverse(this)
  })
}
