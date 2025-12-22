import Handlebars from 'handlebars'

// Flag to prevent registering helpers multiple times
let helpersRegistered = false

/**
 * Register all Handlebars helpers.
 * Call this function once when the feature flag is enabled.
 * Safe to call multiple times - will only register once.
 */
export function registerHandlebarsHelpers(): void {
  if (helpersRegistered) return
  helpersRegistered = true

  // ============================================================================
  // Comparison Helpers
  // ============================================================================

  Handlebars.registerHelper('eq', function (a: unknown, b: unknown): boolean {
    return a === b
  })

Handlebars.registerHelper('ne', function (a: unknown, b: unknown): boolean {
  return a !== b
})

Handlebars.registerHelper('neq', function (a: unknown, b: unknown): boolean {
  return a !== b
})

Handlebars.registerHelper('lt', function (a: unknown, b: unknown): boolean {
  return Number(a) < Number(b)
})

Handlebars.registerHelper('lte', function (a: unknown, b: unknown): boolean {
  return Number(a) <= Number(b)
})

Handlebars.registerHelper('gt', function (a: unknown, b: unknown): boolean {
  return Number(a) > Number(b)
})

Handlebars.registerHelper('gte', function (a: unknown, b: unknown): boolean {
  return Number(a) >= Number(b)
})

Handlebars.registerHelper('and', function (this: unknown, ...args: unknown[]): string {
  const options = args.pop() as Handlebars.HelperOptions
  return args.every(Boolean) ? options.fn(this) : options.inverse(this)
})

Handlebars.registerHelper('or', function (this: unknown, ...args: unknown[]): string {
  const options = args.pop() as Handlebars.HelperOptions
  return args.some(Boolean) ? options.fn(this) : options.inverse(this)
})

Handlebars.registerHelper('not', function (value: unknown): boolean {
  return !value
})

Handlebars.registerHelper('ifEquals', function (this: unknown, a: unknown, b: unknown, options: Handlebars.HelperOptions) {
  return a === b ? options.fn(this) : options.inverse(this)
})

Handlebars.registerHelper('is', function (this: unknown, a: unknown, b: unknown, options: Handlebars.HelperOptions) {
  return String(a) === String(b) ? options.fn(this) : options.inverse(this)
})

Handlebars.registerHelper('isnt', function (this: unknown, a: unknown, b: unknown, options: Handlebars.HelperOptions) {
  return String(a) !== String(b) ? options.fn(this) : options.inverse(this)
})

Handlebars.registerHelper('default', function (value: unknown, defaultValue: unknown): unknown {
  return value ?? defaultValue
})

Handlebars.registerHelper('compare', function (this: unknown, a: unknown, operator: string, b: unknown, options: Handlebars.HelperOptions) {
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

// ============================================================================
// String Helpers
// ============================================================================

Handlebars.registerHelper('lowercase', function (str: unknown): string {
  return typeof str === 'string' ? str.toLowerCase() : ''
})

Handlebars.registerHelper('uppercase', function (str: unknown): string {
  return typeof str === 'string' ? str.toUpperCase() : ''
})

Handlebars.registerHelper('capitalize', function (str: unknown): string {
  if (typeof str !== 'string' || !str) return ''
  return str.charAt(0).toUpperCase() + str.slice(1)
})

Handlebars.registerHelper('capitalizeAll', function (str: unknown): string {
  if (typeof str !== 'string') return ''
  return str.replace(/\b\w/g, c => c.toUpperCase())
})

Handlebars.registerHelper('titleize', function (str: unknown): string {
  if (typeof str !== 'string') return ''
  return str.replace(/\b\w/g, c => c.toUpperCase())
})

Handlebars.registerHelper('camelcase', function (str: unknown): string {
  if (typeof str !== 'string') return ''
  return str.replace(/[-_\s]+(.)?/g, (_, c: string | undefined) => c ? c.toUpperCase() : '')
})

Handlebars.registerHelper('pascalcase', function (str: unknown): string {
  if (typeof str !== 'string') return ''
  const camel = str.replace(/[-_\s]+(.)?/g, (_, c: string | undefined) => c ? c.toUpperCase() : '')
  return camel.charAt(0).toUpperCase() + camel.slice(1)
})

Handlebars.registerHelper('snakecase', function (str: unknown): string {
  if (typeof str !== 'string') return ''
  return str.replace(/([a-z])([A-Z])/g, '$1_$2').replace(/[-\s]+/g, '_').toLowerCase()
})

Handlebars.registerHelper('snakeCase', function (str: unknown): string {
  if (typeof str !== 'string') return ''
  return str.replace(/([a-z])([A-Z])/g, '$1_$2').replace(/[-\s]+/g, '_').toLowerCase()
})

Handlebars.registerHelper('dashcase', function (str: unknown): string {
  if (typeof str !== 'string') return ''
  return str.replace(/([a-z])([A-Z])/g, '$1-$2').replace(/[_\s]+/g, '-').toLowerCase()
})

Handlebars.registerHelper('trim', function (str: unknown): string {
  return typeof str === 'string' ? str.trim() : ''
})

Handlebars.registerHelper('trimLeft', function (str: unknown): string {
  return typeof str === 'string' ? str.trimStart() : ''
})

Handlebars.registerHelper('trimRight', function (str: unknown): string {
  return typeof str === 'string' ? str.trimEnd() : ''
})

Handlebars.registerHelper('replace', function (str: unknown, a: unknown, b: unknown): string {
  if (typeof str !== 'string') return ''
  return str.split(String(a)).join(String(b))
})

Handlebars.registerHelper('split', function (str: unknown, separator: unknown): string[] {
  if (typeof str !== 'string') return []
  const sep = typeof separator === 'string' ? separator : ','
  return str.split(sep)
})

Handlebars.registerHelper('truncate', function (str: unknown, length: unknown, suffix: unknown): string {
  if (typeof str !== 'string') return ''
  const len = Number(length) || 50
  const suf = typeof suffix === 'string' ? suffix : '...'
  return str.length > len ? str.slice(0, len) + suf : str
})

Handlebars.registerHelper('ellipsis', function (str: unknown, length: unknown): string {
  if (typeof str !== 'string') return ''
  const len = Number(length) || 50
  return str.length > len ? str.slice(0, len) + '…' : str
})

Handlebars.registerHelper('append', function (str: unknown, suffix: unknown): string {
  const s = typeof str === 'string' ? str : ''
  const suf = typeof suffix === 'string' ? suffix : ''
  return s + suf
})

Handlebars.registerHelper('prepend', function (str: unknown, prefix: unknown): string {
  const s = typeof str === 'string' ? str : ''
  const pre = typeof prefix === 'string' ? prefix : ''
  return pre + s
})

Handlebars.registerHelper('reverse', function (value: unknown): string | unknown[] {
  if (typeof value === 'string') return value.split('').reverse().join('')
  if (Array.isArray(value)) return (value as unknown[]).slice().reverse()
  return ''
})

Handlebars.registerHelper('startsWith', function (this: unknown, str: unknown, prefix: unknown, options: Handlebars.HelperOptions) {
  if (typeof str === 'string' && typeof prefix === 'string' && str.startsWith(prefix)) {
    return options.fn(this)
  }
  return options.inverse(this)
})

Handlebars.registerHelper('contains', function (this: unknown, str: unknown, substring: unknown, options: Handlebars.HelperOptions) {
  if (typeof str === 'string' && typeof substring === 'string' && str.includes(substring)) {
    return options.fn(this)
  }
  if (Array.isArray(str) && str.includes(substring)) {
    return options.fn(this)
  }
  return options.inverse(this)
})

// ============================================================================
// Math Helpers
// ============================================================================

Handlebars.registerHelper('add', function (a: unknown, b: unknown): number {
  return Number(a) + Number(b)
})

Handlebars.registerHelper('subtract', function (a: unknown, b: unknown): number {
  return Number(a) - Number(b)
})

Handlebars.registerHelper('multiply', function (a: unknown, b: unknown): number {
  return Number(a) * Number(b)
})

Handlebars.registerHelper('divide', function (a: unknown, b: unknown): number {
  return Number(a) / Number(b)
})

Handlebars.registerHelper('modulo', function (a: unknown, b: unknown): number {
  return Number(a) % Number(b)
})

Handlebars.registerHelper('abs', function (a: unknown): number {
  return Math.abs(Number(a))
})

Handlebars.registerHelper('ceil', function (a: unknown): number {
  return Math.ceil(Number(a))
})

Handlebars.registerHelper('floor', function (a: unknown): number {
  return Math.floor(Number(a))
})

Handlebars.registerHelper('round', function (a: unknown): number {
  return Math.round(Number(a))
})

Handlebars.registerHelper('random', function (min: unknown, max: unknown): number {
  const minNum = Number(min)
  const maxNum = Number(max)
  return Math.floor(Math.random() * (maxNum - minNum + 1)) + minNum
})

Handlebars.registerHelper('sum', function (array: unknown): number {
  if (!Array.isArray(array)) return 0
  return array.reduce((acc: number, val) => acc + Number(val), 0)
})

Handlebars.registerHelper('avg', function (array: unknown): number {
  if (!Array.isArray(array) || array.length === 0) return 0
  const sum = array.reduce((acc: number, val) => acc + Number(val), 0)
  return sum / array.length
})

// ============================================================================
// Array Helpers
// ============================================================================

Handlebars.registerHelper('first', function (array: unknown, n: unknown): unknown {
  if (!Array.isArray(array)) return undefined
  if (typeof n === 'number') return array.slice(0, n)
  return array[0]
})

Handlebars.registerHelper('last', function (array: unknown, n: unknown): unknown {
  if (!Array.isArray(array)) return undefined
  if (typeof n === 'number') return array.slice(-n)
  return array[array.length - 1]
})

Handlebars.registerHelper('length', function (value: unknown): number {
  if (Array.isArray(value)) return value.length
  if (typeof value === 'string') return value.length
  if (typeof value === 'object' && value !== null) return Object.keys(value).length
  return 0
})

Handlebars.registerHelper('join', function (array: unknown, separator: unknown): string {
  if (!Array.isArray(array)) return ''
  return array.join(typeof separator === 'string' ? separator : ', ')
})

Handlebars.registerHelper('sort', function (array: unknown): unknown[] {
  if (!Array.isArray(array)) return []
  return (array as unknown[]).slice().sort()
})

Handlebars.registerHelper('unique', function (array: unknown): unknown[] {
  if (!Array.isArray(array)) return []
  return Array.from(new Set(array as unknown[]))
})

Handlebars.registerHelper('inArray', function (this: unknown, array: unknown, value: unknown, options: Handlebars.HelperOptions) {
  if (Array.isArray(array) && array.includes(value)) {
    return options.fn(this)
  }
  return options.inverse(this)
})

Handlebars.registerHelper('isArray', function (value: unknown): boolean {
  return Array.isArray(value)
})

Handlebars.registerHelper('isEmpty', function (this: unknown, value: unknown, options: Handlebars.HelperOptions) {
  const empty = value === null || 
    value === undefined || 
    (Array.isArray(value) && value.length === 0) ||
    (typeof value === 'string' && value.length === 0) ||
    (typeof value === 'object' && Object.keys(value).length === 0)
  return empty ? options.fn(this) : options.inverse(this)
})

// ============================================================================
// Object Helpers
// ============================================================================

Handlebars.registerHelper('JSONstringify', function (obj: unknown): string {
  return JSON.stringify(obj, null, 2)
})

Handlebars.registerHelper('JSONparse', function (str: unknown): unknown {
  if (typeof str !== 'string') return {}
  try {
    return JSON.parse(str) as unknown
  } catch {
    return {}
  }
})

Handlebars.registerHelper('get', function (obj: unknown, path: unknown): unknown {
  if (typeof obj !== 'object' || obj === null || typeof path !== 'string') return undefined
  return path.split('.').reduce((acc: unknown, key) => {
    if (acc && typeof acc === 'object' && key in acc) {
      return (acc as Record<string, unknown>)[key]
    }
    return undefined
  }, obj)
})

Handlebars.registerHelper('isObject', function (value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
})

Handlebars.registerHelper('typeOf', function (value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
})

// ============================================================================
// URL Helpers
// ============================================================================

Handlebars.registerHelper('encodeURI', function (str: unknown): string {
  return typeof str === 'string' ? encodeURIComponent(str) : ''
})

Handlebars.registerHelper('decodeURI', function (str: unknown): string {
  return typeof str === 'string' ? decodeURIComponent(str) : ''
})

// ============================================================================
// Date Helpers
// ============================================================================

Handlebars.registerHelper('year', function (): number {
  return new Date().getFullYear()
})

Handlebars.registerHelper('now', function (): string {
  return new Date().toISOString()
})

Handlebars.registerHelper('timestamp', function (): number {
  return Date.now()
})

Handlebars.registerHelper('formatDate', function (date: unknown, format: unknown): string {
  const d = date instanceof Date ? date : new Date(String(date))
  if (isNaN(d.getTime())) return ''
  const fmt = typeof format === 'string' ? format : 'YYYY-MM-DD'
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hours = String(d.getHours()).padStart(2, '0')
  const minutes = String(d.getMinutes()).padStart(2, '0')
  const seconds = String(d.getSeconds()).padStart(2, '0')
  return fmt
    .replace('YYYY', String(year))
    .replace('MM', month)
    .replace('DD', day)
    .replace('HH', hours)
    .replace('mm', minutes)
    .replace('ss', seconds)
})

// ============================================================================
// Additional String Helpers
// ============================================================================

Handlebars.registerHelper('padStart', function (str: unknown, length: unknown, char: unknown): string {
  if (typeof str !== 'string') return ''
  const len = Number(length) || 0
  const ch = typeof char === 'string' ? char : ' '
  return str.padStart(len, ch)
})

Handlebars.registerHelper('padEnd', function (str: unknown, length: unknown, char: unknown): string {
  if (typeof str !== 'string') return ''
  const len = Number(length) || 0
  const ch = typeof char === 'string' ? char : ' '
  return str.padEnd(len, ch)
})

Handlebars.registerHelper('repeat', function (str: unknown, count: unknown): string {
  if (typeof str !== 'string') return ''
  const n = Number(count) || 0
  return str.repeat(n)
})

Handlebars.registerHelper('substring', function (str: unknown, start: unknown, end: unknown): string {
  if (typeof str !== 'string') return ''
  const s = Number(start) || 0
  const e = typeof end === 'number' ? end : undefined
  return str.substring(s, e)
})

Handlebars.registerHelper('indexOf', function (str: unknown, search: unknown): number {
  if (typeof str !== 'string' || typeof search !== 'string') return -1
  return str.indexOf(search)
})

Handlebars.registerHelper('count', function (str: unknown, substring: unknown): number {
  if (typeof str !== 'string' || typeof substring !== 'string') return 0
  return str.split(substring).length - 1
})

Handlebars.registerHelper('slugify', function (str: unknown): string {
  if (typeof str !== 'string') return ''
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
})

Handlebars.registerHelper('dotcase', function (str: unknown): string {
  if (typeof str !== 'string') return ''
  return str.replace(/([a-z])([A-Z])/g, '$1.$2').replace(/[-_\s]+/g, '.').toLowerCase()
})

Handlebars.registerHelper('pathcase', function (str: unknown): string {
  if (typeof str !== 'string') return ''
  return str.replace(/([a-z])([A-Z])/g, '$1/$2').replace(/[-_\s]+/g, '/').toLowerCase()
})

Handlebars.registerHelper('sentencecase', function (str: unknown): string {
  if (typeof str !== 'string' || !str) return ''
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase()
})

Handlebars.registerHelper('newLineToBr', function (str: unknown): string {
  if (typeof str !== 'string') return ''
  return str.replace(/\n/g, '<br>')
})

Handlebars.registerHelper('stripTags', function (str: unknown): string {
  if (typeof str !== 'string') return ''
  return str.replace(/<[^>]*>/g, '')
})

Handlebars.registerHelper('endsWith', function (this: unknown, str: unknown, suffix: unknown, options: Handlebars.HelperOptions) {
  if (typeof str === 'string' && typeof suffix === 'string' && str.endsWith(suffix)) {
    return options.fn(this)
  }
  return options.inverse(this)
})

Handlebars.registerHelper('match', function (str: unknown, pattern: unknown): string[] | null {
  if (typeof str !== 'string' || typeof pattern !== 'string') return null
  try {
    const regex = new RegExp(pattern, 'g')
    return str.match(regex)
  } catch {
    return null
  }
})

Handlebars.registerHelper('test', function (this: unknown, str: unknown, pattern: unknown, options: Handlebars.HelperOptions) {
  if (typeof str !== 'string' || typeof pattern !== 'string') return options.inverse(this)
  try {
    const regex = new RegExp(pattern)
    return regex.test(str) ? options.fn(this) : options.inverse(this)
  } catch {
    return options.inverse(this)
  }
})

// ============================================================================
// Additional Math Helpers
// ============================================================================

Handlebars.registerHelper('min', function (...args: unknown[]): number {
  args.pop() // Remove options
  const nums = args.map(Number).filter(n => !isNaN(n))
  return nums.length > 0 ? Math.min(...nums) : 0
})

Handlebars.registerHelper('max', function (...args: unknown[]): number {
  args.pop() // Remove options
  const nums = args.map(Number).filter(n => !isNaN(n))
  return nums.length > 0 ? Math.max(...nums) : 0
})

Handlebars.registerHelper('pow', function (base: unknown, exponent: unknown): number {
  return Math.pow(Number(base), Number(exponent))
})

Handlebars.registerHelper('sqrt', function (a: unknown): number {
  return Math.sqrt(Number(a))
})

Handlebars.registerHelper('toFixed', function (num: unknown, decimals: unknown): string {
  const n = Number(num)
  const d = Number(decimals) || 0
  return isNaN(n) ? '0' : n.toFixed(d)
})

Handlebars.registerHelper('toInt', function (num: unknown): number {
  return parseInt(String(num), 10) || 0
})

Handlebars.registerHelper('toFloat', function (num: unknown): number {
  return parseFloat(String(num)) || 0
})

// ============================================================================
// Additional Array Helpers
// ============================================================================

Handlebars.registerHelper('after', function (array: unknown, n: unknown): unknown[] {
  if (!Array.isArray(array)) return []
  return array.slice(Number(n) || 0)
})

Handlebars.registerHelper('before', function (array: unknown, n: unknown): unknown[] {
  if (!Array.isArray(array)) return []
  return array.slice(0, Number(n) || 0)
})

Handlebars.registerHelper('slice', function (array: unknown, start: unknown, end: unknown): unknown[] {
  if (!Array.isArray(array)) return []
  const s = Number(start) || 0
  const e = typeof end === 'number' ? end : undefined
  return array.slice(s, e)
})

Handlebars.registerHelper('concat', function (...args: unknown[]): unknown[] {
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

Handlebars.registerHelper('flatten', function (array: unknown): unknown[] {
  if (!Array.isArray(array)) return []
  return array.flat()
})

Handlebars.registerHelper('pluck', function (array: unknown, prop: unknown): unknown[] {
  if (!Array.isArray(array) || typeof prop !== 'string') return []
  return array.map(item => {
    if (typeof item === 'object' && item !== null && prop in item) {
      return (item as Record<string, unknown>)[prop]
    }
    return undefined
  }).filter(v => v !== undefined)
})

Handlebars.registerHelper('some', function (this: unknown, array: unknown, prop: unknown, value: unknown, options: Handlebars.HelperOptions) {
  if (!Array.isArray(array)) return options.inverse(this)
  const found = array.some(item => {
    if (typeof item === 'object' && item !== null && typeof prop === 'string' && prop in item) {
      return (item as Record<string, unknown>)[prop] === value
    }
    return false
  })
  return found ? options.fn(this) : options.inverse(this)
})

Handlebars.registerHelper('every', function (this: unknown, array: unknown, prop: unknown, value: unknown, options: Handlebars.HelperOptions) {
  if (!Array.isArray(array) || array.length === 0) return options.inverse(this)
  const allMatch = array.every(item => {
    if (typeof item === 'object' && item !== null && typeof prop === 'string' && prop in item) {
      return (item as Record<string, unknown>)[prop] === value
    }
    return false
  })
  return allMatch ? options.fn(this) : options.inverse(this)
})

Handlebars.registerHelper('itemAt', function (array: unknown, idx: unknown): unknown {
  if (!Array.isArray(array)) return undefined
  const index = Number(idx)
  return array[index < 0 ? array.length + index : index]
})

// ============================================================================
// Additional Object Helpers
// ============================================================================

Handlebars.registerHelper('keys', function (obj: unknown): string[] {
  if (typeof obj !== 'object' || obj === null) return []
  return Object.keys(obj)
})

Handlebars.registerHelper('values', function (obj: unknown): unknown[] {
  if (typeof obj !== 'object' || obj === null) return []
  return Object.values(obj)
})

Handlebars.registerHelper('entries', function (obj: unknown): [string, unknown][] {
  if (typeof obj !== 'object' || obj === null) return []
  return Object.entries(obj)
})

Handlebars.registerHelper('hasOwn', function (this: unknown, obj: unknown, key: unknown, options: Handlebars.HelperOptions) {
  if (typeof obj === 'object' && obj !== null && typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key)) {
    return options.fn(this)
  }
  return options.inverse(this)
})

Handlebars.registerHelper('pick', function (obj: unknown, ...keys: unknown[]): Record<string, unknown> {
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

Handlebars.registerHelper('omit', function (obj: unknown, ...keys: unknown[]): Record<string, unknown> {
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

Handlebars.registerHelper('merge', function (...args: unknown[]): Record<string, unknown> {
  args.pop() // Remove options
  const result: Record<string, unknown> = {}
  for (const arg of args) {
    if (typeof arg === 'object' && arg !== null && !Array.isArray(arg)) {
      Object.assign(result, arg)
    }
  }
  return result
})

// ============================================================================
// Additional URL Helpers
// ============================================================================

Handlebars.registerHelper('urlParse', function (url: unknown): Record<string, string> | null {
  if (typeof url !== 'string') return null
  try {
    const parsed = new URL(url)
    return {
      href: parsed.href,
      origin: parsed.origin,
      protocol: parsed.protocol,
      host: parsed.host,
      hostname: parsed.hostname,
      port: parsed.port,
      pathname: parsed.pathname,
      search: parsed.search,
      hash: parsed.hash
    }
  } catch {
    return null
  }
})

Handlebars.registerHelper('stripQuerystring', function (url: unknown): string {
  if (typeof url !== 'string') return ''
  return url.split('?')[0] ?? url
})

Handlebars.registerHelper('stripProtocol', function (url: unknown): string {
  if (typeof url !== 'string') return ''
  return url.replace(/^[a-zA-Z]+:\/\//, '')
})

// ============================================================================
// Misc Helpers
// ============================================================================

Handlebars.registerHelper('coalesce', function (...args: unknown[]): unknown {
  args.pop() // Remove options
  for (const arg of args) {
    if (arg !== null && arg !== undefined) return arg
  }
  return undefined
})

Handlebars.registerHelper('uuid', function (): string {
  return crypto.randomUUID()
})

Handlebars.registerHelper('noop', function (this: unknown, options: Handlebars.HelperOptions): string {
  return options.fn(this)
})

Handlebars.registerHelper('raw', function (this: unknown, options: Handlebars.HelperOptions): string {
  return options.fn(this)
})

Handlebars.registerHelper('times', function (this: unknown, n: unknown, options: Handlebars.HelperOptions): string {
  let result = ''
  const count = Number(n) || 0
  const context = typeof this === 'object' && this !== null ? this : {}
  for (let i = 0; i < count; i++) {
    result += options.fn({ ...context, '@index': i, '@first': i === 0, '@last': i === count - 1 })
  }
  return result
})

  Handlebars.registerHelper('range', function (start: unknown, end: unknown, step: unknown): number[] {
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

export { Handlebars }

// Re-export helper definitions for Monaco autocompletion
export {
  handlebarsHelpersDefinitions,
  handlebarsHelperCategories,
  getHelpersByCategory,
  getTranslatedHelpers,
  type HandlebarsHelperDefinition,
  type HandlebarsHelperCategory,
  type TranslatedHelperDefinition
} from './handlebarsHelpersDefinitions'
