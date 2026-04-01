import type Handlebars from 'handlebars'

export function registerMiscHelpers(hbs: typeof Handlebars): void {
  hbs.registerHelper('coalesce', function (...args: unknown[]): unknown {
    args.pop() // Remove options
    for (const arg of args) {
      if (arg !== null && arg !== undefined) return arg
    }
    return undefined
  })

  hbs.registerHelper('uuid', function (): string {
    return crypto.randomUUID()
  })

  hbs.registerHelper('noop', function (this: unknown, options: Handlebars.HelperOptions): string {
    return options.fn(this)
  })

  hbs.registerHelper('raw', function (this: unknown, options: Handlebars.HelperOptions): string {
    return options.fn(this)
  })

  hbs.registerHelper('times', function (this: unknown, n: unknown, options: Handlebars.HelperOptions): string {
    let result = ''
    const count = Number(n) || 0
    const context = typeof this === 'object' && this !== null ? this : {}
    for (let i = 0; i < count; i++) {
      result += options.fn({ ...context, '@index': i, '@first': i === 0, '@last': i === count - 1 })
    }
    return result
  })

  hbs.registerHelper('range', function (start: unknown, end: unknown, step: unknown): number[] {
    const s = Number(start) || 0
    const e = Number(end) || 0
    const st = Number(step) || 1
    const result: number[] = []
    if (st > 0) {
      for (let i = s; i < e; i += st) result.push(i)
    } else if (st < 0) {
      for (let i = s; i > e; i += st) result.push(i)
    }
    return result
  })
}
