import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Guard: every `titleKey` a restorm MCP tool declares at registration must
 * resolve to a real string in restorm's EN locale. Catches the "declared the
 * key but forgot the translation" gap in CI rather than at a user's screen.
 *
 * Source-scan (not service instantiation) so it stays cheap + dependency-free:
 * the registration sites carry the keys, and the locale carries the values.
 */
function lookup(obj: Record<string, unknown>, key: string): unknown {
  return key.split('.').reduce<unknown>(
    (acc, part) => (acc !== null && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined),
    obj
  )
}

describe('restorm MCP tool title keys', () => {
  const toolsDir = join(__dirname, 'tools')
  const en = JSON.parse(
    readFileSync(join(__dirname, '../../renderer/locales/en/translation.json'), 'utf-8')
  ) as Record<string, unknown>

  // Collect every `titleKey: 'mcpToolTitles.X'` declared across the tool files.
  const keys = new Set<string>()
  for (const file of readdirSync(toolsDir)) {
    if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue
    const src = readFileSync(join(toolsDir, file), 'utf-8')
    for (const m of src.matchAll(/titleKey:\s*'([^']+)'/g)) keys.add(m[1])
  }

  it('finds titleKeys declared in the tool files', () => {
    expect(keys.size).toBeGreaterThan(0)
  })

  it('every declared titleKey resolves to a real EN string', () => {
    const broken: string[] = []
    for (const key of keys) {
      const value = lookup(en, key)
      if (typeof value !== 'string' || value.length === 0 || value === key) {
        broken.push(`${key} (${String(value)})`)
      }
    }
    expect(broken).toEqual([])
  })
})
