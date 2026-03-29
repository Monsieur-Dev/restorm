import type Handlebars from 'handlebars'

export function registerURLHelpers(hbs: typeof Handlebars): void {
  hbs.registerHelper('encodeURI', function (str: unknown): string {
    return typeof str === 'string' ? encodeURIComponent(str) : ''
  })

  hbs.registerHelper('decodeURI', function (str: unknown): string {
    return typeof str === 'string' ? decodeURIComponent(str) : ''
  })

  hbs.registerHelper('urlParse', function (url: unknown): Record<string, string> | null {
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

  hbs.registerHelper('stripQuerystring', function (url: unknown): string {
    if (typeof url !== 'string') return ''
    return url.split('?')[0] ?? url
  })

  hbs.registerHelper('stripProtocol', function (url: unknown): string {
    if (typeof url !== 'string') return ''
    return url.replace(/^[a-zA-Z]+:\/\//, '')
  })
}
