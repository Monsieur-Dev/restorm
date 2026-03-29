import type Handlebars from 'handlebars'

export function registerObjectHelpers(hbs: typeof Handlebars): void {
  hbs.registerHelper('JSONstringify', function (obj: unknown): string {
    return JSON.stringify(obj, null, 2)
  })

  hbs.registerHelper('JSONparse', function (str: unknown): unknown {
    if (typeof str !== 'string') return {}
    try {
      return JSON.parse(str) as unknown
    } catch {
      return {}
    }
  })

  hbs.registerHelper('get', function (obj: unknown, path: unknown): unknown {
    if (typeof obj !== 'object' || obj === null || typeof path !== 'string') return undefined
    return path.split('.').reduce((acc: unknown, key) => {
      if (acc && typeof acc === 'object' && key in acc) {
        return (acc as Record<string, unknown>)[key]
      }
      return undefined
    }, obj)
  })

  hbs.registerHelper('isObject', function (value: unknown): boolean {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  })

  hbs.registerHelper('typeOf', function (value: unknown): string {
    if (value === null) return 'null'
    if (Array.isArray(value)) return 'array'
    return typeof value
  })

  hbs.registerHelper('keys', function (obj: unknown): string[] {
    if (typeof obj !== 'object' || obj === null) return []
    return Object.keys(obj)
  })

  hbs.registerHelper('values', function (obj: unknown): unknown[] {
    if (typeof obj !== 'object' || obj === null) return []
    return Object.values(obj)
  })

  hbs.registerHelper('entries', function (obj: unknown): [string, unknown][] {
    if (typeof obj !== 'object' || obj === null) return []
    return Object.entries(obj)
  })

  hbs.registerHelper('hasOwn', function (this: unknown, obj: unknown, key: unknown, options: Handlebars.HelperOptions) {
    if (typeof obj === 'object' && obj !== null && typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key)) {
      return options.fn(this)
    }
    return options.inverse(this)
  })

  hbs.registerHelper('pick', function (obj: unknown, ...keys: unknown[]): Record<string, unknown> {
    keys.pop() // Remove options
    if (typeof obj !== 'object' || obj === null) return {}
    const result: Record<string, unknown> = {}
    for (const k of keys) {
      if (typeof k === 'string' && k in obj) {
        result[k] = (obj as Record<string, unknown>)[k]
      }
    }
    return result
  })

  hbs.registerHelper('omit', function (obj: unknown, ...keys: unknown[]): Record<string, unknown> {
    keys.pop() // Remove options
    if (typeof obj !== 'object' || obj === null) return {}
    const keysToOmit = new Set(keys.filter(k => typeof k === 'string'))
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) {
      if (!keysToOmit.has(k)) {
        result[k] = v
      }
    }
    return result
  })

  hbs.registerHelper('merge', function (...args: unknown[]): Record<string, unknown> {
    args.pop() // Remove options
    const result: Record<string, unknown> = {}
    for (const arg of args) {
      if (typeof arg === 'object' && arg !== null && !Array.isArray(arg)) {
        Object.assign(result, arg)
      }
    }
    return result
  })
}
