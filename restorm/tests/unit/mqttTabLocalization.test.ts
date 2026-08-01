// @vitest-environment node
/**
 * The MQTT options panel ships its labels through `t('mqtt.*')`, so a key that
 * exists in a locale but still holds the English string is invisible to any
 * "missing key" check — the panel simply renders English next to translated
 * neighbours. These tests pin both halves of that: every key present in every
 * locale, and no key left at its English value unless the language genuinely
 * uses the English term.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { inlineFieldLabelStyle } from '../../src/renderer/src/components/RequestTabViews/requestTabViewUtils'

const LOCALES_DIR = join(__dirname, '..', '..', 'src', 'renderer', 'locales')

/** Protocol vocabulary that stays English in every language. */
const PROTOCOL_TERMS = ['qos', 'keepalive']

/**
 * Per-locale keys whose English wording IS the term that language uses — each
 * one matches the locale's own translation of the same concept elsewhere in
 * its catalogue (`websocket.topic`, `mcpLogs.payload`, …).
 */
const KEEPS_ENGLISH_WORD: Record<string, string[]> = {
  de: ['topic', 'lwtTopicPlaceholder'],
  es: ['topic'],
  fr: ['topic'],
  it: ['password', 'topic', 'lwtPayload'],
  ja: ['lwtTopicPlaceholder'],
  ko: ['lwtTopicPlaceholder'],
  nl: ['lwtPayload'],
  sv: ['topic'],
  'zh-CN': ['lwtTopicPlaceholder'],
  'zh-TW': ['lwtTopicPlaceholder']
}

function mqttSection(locale: string): Record<string, string> {
  const raw = readFileSync(join(LOCALES_DIR, locale, 'translation.json'), 'utf-8')
  const parsed = JSON.parse(raw) as { mqtt?: Record<string, string> }
  return parsed.mqtt ?? {}
}

const locales = readdirSync(LOCALES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

const english = mqttSection('en')
const translatable = Object.keys(english)

describe('MQTT tab localization', () => {
  it('has an English catalogue to compare against', () => {
    expect(locales.length).toBeGreaterThan(1)
    // The labels the panel renders — a rename here must break the test.
    expect(translatable).toEqual(
      expect.arrayContaining(['retain', 'clientId', 'username', 'password', 'topic', 'lwtPayload'])
    )
  })

  it.each(locales)('defines every mqtt key in %s', (locale) => {
    const section = mqttSection(locale)
    expect(translatable.filter((key) => !(key in section))).toEqual([])
  })

  it.each(locales.filter((l) => l !== 'en'))('translates every mqtt label in %s', (locale) => {
    const section = mqttSection(locale)
    const allowed = new Set([...PROTOCOL_TERMS, ...(KEEPS_ENGLISH_WORD[locale] ?? [])])
    const untranslated = translatable.filter(
      (key) => section[key] === english[key] && !allowed.has(key)
    )
    expect(untranslated).toEqual([])
  })
})

describe('inline field label style', () => {
  // A label sharing a flex row with a `flex: 1` input shrinks to its
  // min-content width without these. Every CJK character is a break
  // opportunity, so the label then stacks one glyph per line.
  it('cannot shrink or wrap', () => {
    expect(inlineFieldLabelStyle.flexShrink).toBe(0)
    expect(inlineFieldLabelStyle.whiteSpace).toBe('nowrap')
  })

  it('is the style every inline request-tab label uses', () => {
    const views = ['WebSocketRequestTabView.tsx', 'StompRequestTabView.tsx']
    for (const view of views) {
      const source = readFileSync(
        join(__dirname, '..', '..', 'src', 'renderer', 'src', 'components', 'RequestTabViews', view),
        'utf-8'
      )
      // No inline label may re-declare a bare `fontSize: 12` span style: that
      // is exactly the shape that dropped `flexShrink` and broke CJK.
      expect(source).not.toContain("<span style={{ fontSize: 12 }}>")
    }
  })
})
