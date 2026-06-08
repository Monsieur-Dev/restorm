import { describe, it, expect } from 'vitest'
import { SCENARIO_KIND_DOCS } from '../../../../shared/scenarioKindDocs'
import cs from '../../../locales/cs/translation.json'
import da from '../../../locales/da/translation.json'
import de from '../../../locales/de/translation.json'
import el from '../../../locales/el/translation.json'
import en from '../../../locales/en/translation.json'
import es from '../../../locales/es/translation.json'
import fi from '../../../locales/fi/translation.json'
import fr from '../../../locales/fr/translation.json'
import hr from '../../../locales/hr/translation.json'
import hu from '../../../locales/hu/translation.json'
import id from '../../../locales/id/translation.json'
import itLocale from '../../../locales/it/translation.json'
import ja from '../../../locales/ja/translation.json'
import ko from '../../../locales/ko/translation.json'
import nb from '../../../locales/nb/translation.json'
import nl from '../../../locales/nl/translation.json'
import pl from '../../../locales/pl/translation.json'
import pt from '../../../locales/pt/translation.json'
import ro from '../../../locales/ro/translation.json'
import sq from '../../../locales/sq/translation.json'
import sr from '../../../locales/sr/translation.json'
import sv from '../../../locales/sv/translation.json'
import tr from '../../../locales/tr/translation.json'
import uk from '../../../locales/uk/translation.json'
import vi from '../../../locales/vi/translation.json'
import zhCN from '../../../locales/zh-CN/translation.json'
import zhTW from '../../../locales/zh-TW/translation.json'

const ALL_LOCALES: Record<string, unknown> = {
  cs, da, de, el, en, es, fi, fr, hr, hu, id, it: itLocale, ja, ko, nb, nl, pl, pt, ro, sq, sr, sv, tr, uk, vi,
  'zh-CN': zhCN,
  'zh-TW': zhTW
}

/**
 * Every scenario node kind must expose a `scenario.help.<kind>` text — it's what
 * the inspector shows under "what this action does" for a selected box. The
 * kind set is the exhaustive `SCENARIO_KIND_DOCS` record, so a new kind fails
 * this test until its help text (and translations) are added.
 */
describe('scenario node help i18n', () => {
  const help = (loc: typeof en): Record<string, string> =>
    (loc as { scenario?: { help?: Record<string, string> } }).scenario?.help ?? {}

  it('en has a non-empty help text for every node kind', () => {
    const h = help(en)
    const missing = Object.keys(SCENARIO_KIND_DOCS).filter((k) => typeof h[k] !== 'string' || h[k].trim() === '')
    expect(missing).toEqual([])
  })

  it('fr has the same help keys as en (no missing / extra)', () => {
    expect(Object.keys(help(fr)).sort()).toEqual(Object.keys(help(en)).sort())
  })
})

/**
 * The inspector legend (empty-state help) is fully translated: every shipped
 * locale must carry all `scenario.legend.*` keys with non-empty values, or that
 * language silently falls back to English mid-panel.
 */
describe('scenario inspector legend i18n', () => {
  const LEGEND_KEYS = [
    'title',
    'portsTitle',
    'entryEventTrigger',
    'entryDataTrigger',
    'runWhenAllReceived',
    'outPortsTitle',
    'outEmit',
    'outEmitSignalOnly',
    'genericOutPortsTitle',
    'outDone',
    'outError',
    'navTitle',
    'zoom',
    'pan',
    'boxSelect',
    'select'
  ]

  const legendOf = (loc: unknown): Record<string, string> =>
    (loc as { scenario?: { legend?: Record<string, string> } }).scenario?.legend ?? {}

  it('every locale defines all legend keys with non-empty values', () => {
    const offenders: string[] = []
    for (const [locale, mod] of Object.entries(ALL_LOCALES)) {
      const legend = legendOf(mod)
      for (const key of LEGEND_KEYS) {
        if (typeof legend[key] !== 'string' || legend[key].trim() === '') {
          offenders.push(`${locale}.${key}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
