import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { McpService } from './McpService'

vi.mock('electron', () => ({
  app: { on: vi.fn(), off: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn(), showMessageBox: vi.fn() },
  protocol: { handle: vi.fn() },
  net: { fetch: vi.fn() }
}))
vi.mock('./LoggerService', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

/** Resolve a dotted i18n key against a locale JSON object. */
function lookup(obj: Record<string, unknown>, key: string): unknown {
  return key.split('.').reduce<unknown>(
    (acc, part) => (acc !== null && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined),
    obj
  )
}

describe('McpService built-in tool title keys', () => {
  const en = JSON.parse(
    readFileSync(join(__dirname, '../../renderer/locales/en/translation.json'), 'utf-8')
  ) as Record<string, unknown>

  // A fresh service registers all generic (ECUI) built-in tools in its ctor.
  const service = new McpService()
  const tools = service.getRegisteredToolTitleKeys()

  it('registers built-in tools', () => {
    expect(tools.length).toBeGreaterThan(0)
  })

  it('every built-in tool declares a titleKey that resolves to a real EN string', () => {
    const broken: string[] = []
    for (const { name, titleKey } of tools) {
      const value = lookup(en, titleKey)
      // Must be a non-empty string AND not just the key echoed back — that's
      // the "declared the key but forgot the translation" gap this guards.
      if (typeof value !== 'string' || value.length === 0 || value === titleKey) {
        broken.push(`${name} → ${titleKey} (${String(value)})`)
      }
    }
    expect(broken).toEqual([])
  })
})
