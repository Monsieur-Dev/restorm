import type Handlebars from 'handlebars'

export function registerDateHelpers(hbs: typeof Handlebars): void {
  hbs.registerHelper('year', function (): number {
    return new Date().getFullYear()
  })

  hbs.registerHelper('now', function (): string {
    return new Date().toISOString()
  })

  hbs.registerHelper('timestamp', function (): number {
    return Date.now()
  })

  hbs.registerHelper('formatDate', function (date: unknown, format: unknown): string {
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
}
