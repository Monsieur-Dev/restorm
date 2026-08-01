// @vitest-environment node
/**
 * An ECUI `small` Button is sized for a codicon and clips its content, so text
 * children come out as a fragment of a word — the auth tab's "Add produced
 * header" rendered as the middle of "prod-uce-d". A small button therefore
 * carries its icon only, with the name on the ECUI tooltip (hover) and the
 * aria-label (screen reader); `title` is banned because it raises the browser's
 * unstyled native tooltip instead.
 *
 * This is a source-shape guard, not a rendering one: the clipping is CSS, so
 * the only thing a unit test can pin is the shape that produced it.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const VIEWS_DIR = join(__dirname, '..', '..', 'src', 'renderer', 'src', 'components', 'RequestTabViews')

/** Every `<Button …>` element in a source, as its full opening tag + body. */
function buttonElements(source: string): string[] {
  const out: string[] = []
  const opens = [...source.matchAll(/<Button(\s|>)/g)]
  for (const match of opens) {
    const start = match.index
    // Self-closing (`/>`) or paired (`</Button>`), whichever terminates first.
    const selfClose = source.indexOf('/>', start)
    const paired = source.indexOf('</Button>', start)
    const end = paired !== -1 && (selfClose === -1 || paired < selfClose)
      ? paired + '</Button>'.length
      : selfClose + 2
    out.push(source.slice(start, end))
  }
  return out
}

const sources = readdirSync(VIEWS_DIR)
  .filter((name) => name.endsWith('.tsx') && !name.includes('.test.'))
  .map((name) => ({ name, source: readFileSync(join(VIEWS_DIR, name), 'utf-8') }))

describe('small buttons in the request tab views', () => {
  it('finds buttons to check', () => {
    const total = sources.reduce((n, f) => n + buttonElements(f.source).length, 0)
    expect(total).toBeGreaterThan(5)
  })

  it.each(sources.map((f) => f.name))('%s declares no small Button with a text label', (name) => {
    const file = sources.find((f) => f.name === name)
    const offenders = buttonElements(file?.source ?? '')
      .filter((el) => /(^|\s)small(\s|\n|>)/.test(el))
      // A paired tag whose body is not whitespace/comment is a text label.
      .filter((el) => {
        const body = />([\s\S]*)<\/Button>/.exec(el)?.[1]
        return body !== undefined && body.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').trim().length > 0
      })
    expect(offenders).toEqual([])
  })

  it('gives the produced-header button an accessible name without a native tooltip', () => {
    const source = sources.find((f) => f.name === 'AuthenticationConfigurationTab.tsx')?.source ?? ''
    const button = buttonElements(source).find((el) => el.includes('auth-request-add-produced-header-button'))
    expect(button).toBeDefined()
    expect(button).toContain('ariaLabel')
    expect(button).not.toContain('title:')
  })
})
