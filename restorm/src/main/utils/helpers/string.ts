import type Handlebars from 'handlebars'

export function registerStringHelpers(hbs: typeof Handlebars): void {
  hbs.registerHelper('lowercase', function (str: unknown): string {
    return typeof str === 'string' ? str.toLowerCase() : ''
  })

  hbs.registerHelper('uppercase', function (str: unknown): string {
    return typeof str === 'string' ? str.toUpperCase() : ''
  })

  hbs.registerHelper('capitalize', function (str: unknown): string {
    if (typeof str !== 'string' || !str) return ''
    return str.charAt(0).toUpperCase() + str.slice(1)
  })

  hbs.registerHelper('capitalizeAll', function (str: unknown): string {
    if (typeof str !== 'string') return ''
    return str.replace(/\b\w/g, c => c.toUpperCase())
  })

  hbs.registerHelper('titleize', function (str: unknown): string {
    if (typeof str !== 'string') return ''
    return str.replace(/\b\w/g, c => c.toUpperCase())
  })

  hbs.registerHelper('camelcase', function (str: unknown): string {
    if (typeof str !== 'string') return ''
    return str.replace(/[-_\s]+(.)?/g, (_, c: string | undefined) => c ? c.toUpperCase() : '')
  })

  hbs.registerHelper('pascalcase', function (str: unknown): string {
    if (typeof str !== 'string') return ''
    const camel = str.replace(/[-_\s]+(.)?/g, (_, c: string | undefined) => c ? c.toUpperCase() : '')
    return camel.charAt(0).toUpperCase() + camel.slice(1)
  })

  hbs.registerHelper('snakecase', function (str: unknown): string {
    if (typeof str !== 'string') return ''
    return str.replace(/([a-z])([A-Z])/g, '$1_$2').replace(/[-\s]+/g, '_').toLowerCase()
  })

  hbs.registerHelper('snakeCase', function (str: unknown): string {
    if (typeof str !== 'string') return ''
    return str.replace(/([a-z])([A-Z])/g, '$1_$2').replace(/[-\s]+/g, '_').toLowerCase()
  })

  hbs.registerHelper('dashcase', function (str: unknown): string {
    if (typeof str !== 'string') return ''
    return str.replace(/([a-z])([A-Z])/g, '$1-$2').replace(/[_\s]+/g, '-').toLowerCase()
  })

  hbs.registerHelper('trim', function (str: unknown): string {
    return typeof str === 'string' ? str.trim() : ''
  })

  hbs.registerHelper('trimLeft', function (str: unknown): string {
    return typeof str === 'string' ? str.trimStart() : ''
  })

  hbs.registerHelper('trimRight', function (str: unknown): string {
    return typeof str === 'string' ? str.trimEnd() : ''
  })

  hbs.registerHelper('replace', function (str: unknown, a: unknown, b: unknown): string {
    if (typeof str !== 'string') return ''
    return str.split(String(a)).join(String(b))
  })

  hbs.registerHelper('split', function (str: unknown, separator: unknown): string[] {
    if (typeof str !== 'string') return []
    const sep = typeof separator === 'string' ? separator : ','
    return str.split(sep)
  })

  hbs.registerHelper('truncate', function (str: unknown, length: unknown, suffix: unknown): string {
    if (typeof str !== 'string') return ''
    const len = Number(length) || 50
    const suf = typeof suffix === 'string' ? suffix : '...'
    return str.length > len ? str.slice(0, len) + suf : str
  })

  hbs.registerHelper('ellipsis', function (str: unknown, length: unknown): string {
    if (typeof str !== 'string') return ''
    const len = Number(length) || 50
    return str.length > len ? str.slice(0, len) + '\u2026' : str
  })

  hbs.registerHelper('append', function (str: unknown, suffix: unknown): string {
    const s = typeof str === 'string' ? str : ''
    const suf = typeof suffix === 'string' ? suffix : ''
    return s + suf
  })

  hbs.registerHelper('prepend', function (str: unknown, prefix: unknown): string {
    const s = typeof str === 'string' ? str : ''
    const pre = typeof prefix === 'string' ? prefix : ''
    return pre + s
  })

  hbs.registerHelper('reverse', function (value: unknown): string | unknown[] {
    if (typeof value === 'string') return value.split('').reverse().join('')
    if (Array.isArray(value)) return (value as unknown[]).slice().reverse()
    return ''
  })

  hbs.registerHelper('startsWith', function (this: unknown, str: unknown, prefix: unknown, options: Handlebars.HelperOptions) {
    if (typeof str === 'string' && typeof prefix === 'string' && str.startsWith(prefix)) {
      return options.fn(this)
    }
    return options.inverse(this)
  })

  hbs.registerHelper('contains', function (this: unknown, str: unknown, substring: unknown, options: Handlebars.HelperOptions) {
    if (typeof str === 'string' && typeof substring === 'string' && str.includes(substring)) {
      return options.fn(this)
    }
    if (Array.isArray(str) && str.includes(substring)) {
      return options.fn(this)
    }
    return options.inverse(this)
  })

  hbs.registerHelper('endsWith', function (this: unknown, str: unknown, suffix: unknown, options: Handlebars.HelperOptions) {
    if (typeof str === 'string' && typeof suffix === 'string' && str.endsWith(suffix)) {
      return options.fn(this)
    }
    return options.inverse(this)
  })

  hbs.registerHelper('match', function (str: unknown, pattern: unknown): string[] | null {
    if (typeof str !== 'string' || typeof pattern !== 'string') return null
    try {
      const regex = new RegExp(pattern, 'g')
      return str.match(regex)
    } catch {
      return null
    }
  })

  hbs.registerHelper('test', function (this: unknown, str: unknown, pattern: unknown, options: Handlebars.HelperOptions) {
    if (typeof str !== 'string' || typeof pattern !== 'string') return options.inverse(this)
    try {
      const regex = new RegExp(pattern)
      return regex.test(str) ? options.fn(this) : options.inverse(this)
    } catch {
      return options.inverse(this)
    }
  })

  hbs.registerHelper('padStart', function (str: unknown, length: unknown, char: unknown): string {
    if (typeof str !== 'string') return ''
    const len = Number(length) || 0
    const ch = typeof char === 'string' ? char : ' '
    return str.padStart(len, ch)
  })

  hbs.registerHelper('padEnd', function (str: unknown, length: unknown, char: unknown): string {
    if (typeof str !== 'string') return ''
    const len = Number(length) || 0
    const ch = typeof char === 'string' ? char : ' '
    return str.padEnd(len, ch)
  })

  hbs.registerHelper('repeat', function (str: unknown, count: unknown): string {
    if (typeof str !== 'string') return ''
    const n = Number(count) || 0
    return str.repeat(n)
  })

  hbs.registerHelper('substring', function (str: unknown, start: unknown, end: unknown): string {
    if (typeof str !== 'string') return ''
    const s = Number(start) || 0
    const e = typeof end === 'number' ? end : undefined
    return str.substring(s, e)
  })

  hbs.registerHelper('indexOf', function (str: unknown, search: unknown): number {
    if (typeof str !== 'string' || typeof search !== 'string') return -1
    return str.indexOf(search)
  })

  hbs.registerHelper('count', function (str: unknown, substring: unknown): number {
    if (typeof str !== 'string' || typeof substring !== 'string') return 0
    return str.split(substring).length - 1
  })

  hbs.registerHelper('slugify', function (str: unknown): string {
    if (typeof str !== 'string') return ''
    return str
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
  })

  hbs.registerHelper('dotcase', function (str: unknown): string {
    if (typeof str !== 'string') return ''
    return str.replace(/([a-z])([A-Z])/g, '$1.$2').replace(/[-_\s]+/g, '.').toLowerCase()
  })

  hbs.registerHelper('pathcase', function (str: unknown): string {
    if (typeof str !== 'string') return ''
    return str.replace(/([a-z])([A-Z])/g, '$1/$2').replace(/[-_\s]+/g, '/').toLowerCase()
  })

  hbs.registerHelper('sentencecase', function (str: unknown): string {
    if (typeof str !== 'string' || !str) return ''
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase()
  })

  hbs.registerHelper('newLineToBr', function (str: unknown): string {
    if (typeof str !== 'string') return ''
    return str.replace(/\n/g, '<br>')
  })

  hbs.registerHelper('stripTags', function (str: unknown): string {
    if (typeof str !== 'string') return ''
    return str.replace(/<[^>]*>/g, '')
  })
}
