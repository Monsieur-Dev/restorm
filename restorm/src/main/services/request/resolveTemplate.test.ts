// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

// Mock the main logger so this runs in a plain node env (no electron).
vi.mock('electron-core-ui/main', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }
}))

import { resolveTemplate } from './resolveTemplate'

describe('resolveTemplate', () => {
  it('returns the raw string when there is no template', () => {
    expect(resolveTemplate('https://api.example.com', {})).toBe('https://api.example.com')
  })

  it('resolves a simple variable', () => {
    expect(resolveTemplate('{{base}}/v1', { base: 'https://x' })).toBe('https://x/v1')
  })

  it('drops prototype-polluting context keys (no Object.prototype reach)', () => {
    // A context built from untrusted env data carrying a __proto__ own-key
    // must not pollute, and the key must not be resolvable.
    const ctx = JSON.parse('{"__proto__":{"polluted":"yes"},"safe":"ok"}') as Record<string, unknown>
    expect(resolveTemplate('{{safe}}', ctx)).toBe('ok')
    // The pollution attempt did not leak onto Object.prototype.
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
  })

  it('returns the raw template on a compile error (does not throw)', () => {
    // An unclosed expression makes Handlebars.compile throw.
    expect(resolveTemplate('{{#if}}', {})).toBe('{{#if}}')
  })
})
