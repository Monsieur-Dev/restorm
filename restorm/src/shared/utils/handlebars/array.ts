import type Handlebars from 'handlebars'

export function registerArrayHelpers(hbs: typeof Handlebars): void {
  hbs.registerHelper('first', function (array: unknown, n: unknown): unknown {
    if (!Array.isArray(array)) return undefined
    if (typeof n === 'number') return array.slice(0, n)
    return array[0]
  })

  hbs.registerHelper('last', function (array: unknown, n: unknown): unknown {
    if (!Array.isArray(array)) return undefined
    if (typeof n === 'number') return array.slice(-n)
    return array[array.length - 1]
  })

  hbs.registerHelper('length', function (value: unknown): number {
    if (Array.isArray(value)) return value.length
    if (typeof value === 'string') return value.length
    if (typeof value === 'object' && value !== null) return Object.keys(value).length
    return 0
  })

  hbs.registerHelper('join', function (array: unknown, separator: unknown): string {
    if (!Array.isArray(array)) return ''
    return array.join(typeof separator === 'string' ? separator : ', ')
  })

  hbs.registerHelper('sort', function (array: unknown): unknown[] {
    if (!Array.isArray(array)) return []
    return (array as unknown[]).slice().sort()
  })

  hbs.registerHelper('unique', function (array: unknown): unknown[] {
    if (!Array.isArray(array)) return []
    return Array.from(new Set(array as unknown[]))
  })

  hbs.registerHelper('inArray', function (this: unknown, array: unknown, value: unknown, options: Handlebars.HelperOptions) {
    if (Array.isArray(array) && array.includes(value)) {
      return options.fn(this)
    }
    return options.inverse(this)
  })

  hbs.registerHelper('isArray', function (value: unknown): boolean {
    return Array.isArray(value)
  })

  hbs.registerHelper('isEmpty', function (this: unknown, value: unknown, options: Handlebars.HelperOptions) {
    const empty = value === null ||
      value === undefined ||
      (Array.isArray(value) && value.length === 0) ||
      (typeof value === 'string' && value.length === 0) ||
      (typeof value === 'object' && Object.keys(value).length === 0)
    return empty ? options.fn(this) : options.inverse(this)
  })

  hbs.registerHelper('after', function (array: unknown, n: unknown): unknown[] {
    if (!Array.isArray(array)) return []
    return array.slice(Number(n) || 0)
  })

  hbs.registerHelper('before', function (array: unknown, n: unknown): unknown[] {
    if (!Array.isArray(array)) return []
    return array.slice(0, Number(n) || 0)
  })

  hbs.registerHelper('slice', function (array: unknown, start: unknown, end: unknown): unknown[] {
    if (!Array.isArray(array)) return []
    const s = Number(start) || 0
    const e = typeof end === 'number' ? end : undefined
    return array.slice(s, e)
  })

  hbs.registerHelper('concat', function (...args: unknown[]): unknown[] {
    args.pop() // Remove options
    const result: unknown[] = []
    for (const arg of args) {
      if (Array.isArray(arg)) {
        for (const item of arg) result.push(item)
      } else if (arg !== undefined && arg !== null) {
        result.push(arg)
      }
    }
    return result
  })

  hbs.registerHelper('flatten', function (array: unknown): unknown[] {
    if (!Array.isArray(array)) return []
    return array.flat()
  })

  hbs.registerHelper('pluck', function (array: unknown, prop: unknown): unknown[] {
    if (!Array.isArray(array) || typeof prop !== 'string') return []
    return array.map(item => {
      if (typeof item === 'object' && item !== null && prop in item) {
        return (item as Record<string, unknown>)[prop]
      }
      return undefined
    }).filter(v => v !== undefined)
  })

  hbs.registerHelper('some', function (this: unknown, array: unknown, prop: unknown, value: unknown, options: Handlebars.HelperOptions) {
    if (!Array.isArray(array)) return options.inverse(this)
    const found = array.some(item => {
      if (typeof item === 'object' && item !== null && typeof prop === 'string' && prop in item) {
        return (item as Record<string, unknown>)[prop] === value
      }
      return false
    })
    return found ? options.fn(this) : options.inverse(this)
  })

  hbs.registerHelper('every', function (this: unknown, array: unknown, prop: unknown, value: unknown, options: Handlebars.HelperOptions) {
    if (!Array.isArray(array) || array.length === 0) return options.inverse(this)
    const allMatch = array.every(item => {
      if (typeof item === 'object' && item !== null && typeof prop === 'string' && prop in item) {
        return (item as Record<string, unknown>)[prop] === value
      }
      return false
    })
    return allMatch ? options.fn(this) : options.inverse(this)
  })

  hbs.registerHelper('itemAt', function (array: unknown, idx: unknown): unknown {
    if (!Array.isArray(array)) return undefined
    const index = Number(idx)
    return array[index < 0 ? array.length + index : index]
  })
}
