import type Handlebars from 'handlebars'

export function registerMathHelpers(hbs: typeof Handlebars): void {
  hbs.registerHelper('add', function (a: unknown, b: unknown): number {
    return Number(a) + Number(b)
  })

  hbs.registerHelper('subtract', function (a: unknown, b: unknown): number {
    return Number(a) - Number(b)
  })

  hbs.registerHelper('multiply', function (a: unknown, b: unknown): number {
    return Number(a) * Number(b)
  })

  hbs.registerHelper('divide', function (a: unknown, b: unknown): number {
    return Number(a) / Number(b)
  })

  hbs.registerHelper('modulo', function (a: unknown, b: unknown): number {
    return Number(a) % Number(b)
  })

  hbs.registerHelper('abs', function (a: unknown): number {
    return Math.abs(Number(a))
  })

  hbs.registerHelper('ceil', function (a: unknown): number {
    return Math.ceil(Number(a))
  })

  hbs.registerHelper('floor', function (a: unknown): number {
    return Math.floor(Number(a))
  })

  hbs.registerHelper('round', function (a: unknown): number {
    return Math.round(Number(a))
  })

  hbs.registerHelper('random', function (min: unknown, max: unknown): number {
    const minNum = Number(min)
    const maxNum = Number(max)
    return Math.floor(Math.random() * (maxNum - minNum + 1)) + minNum
  })

  hbs.registerHelper('sum', function (array: unknown): number {
    if (!Array.isArray(array)) return 0
    return array.reduce((acc: number, val) => acc + Number(val), 0)
  })

  hbs.registerHelper('avg', function (array: unknown): number {
    if (!Array.isArray(array) || array.length === 0) return 0
    const sum = array.reduce((acc: number, val) => acc + Number(val), 0)
    return sum / array.length
  })

  hbs.registerHelper('min', function (...args: unknown[]): number {
    args.pop() // Remove options
    const nums = args.map(Number).filter(n => !isNaN(n))
    return nums.length > 0 ? Math.min(...nums) : 0
  })

  hbs.registerHelper('max', function (...args: unknown[]): number {
    args.pop() // Remove options
    const nums = args.map(Number).filter(n => !isNaN(n))
    return nums.length > 0 ? Math.max(...nums) : 0
  })

  hbs.registerHelper('pow', function (base: unknown, exponent: unknown): number {
    return Math.pow(Number(base), Number(exponent))
  })

  hbs.registerHelper('sqrt', function (a: unknown): number {
    return Math.sqrt(Number(a))
  })

  hbs.registerHelper('toFixed', function (num: unknown, decimals: unknown): string {
    const n = Number(num)
    const d = Number(decimals) || 0
    return isNaN(n) ? '0' : n.toFixed(d)
  })

  hbs.registerHelper('toInt', function (num: unknown): number {
    return parseInt(String(num), 10) || 0
  })

  hbs.registerHelper('toFloat', function (num: unknown): number {
    return parseFloat(String(num)) || 0
  })
}
