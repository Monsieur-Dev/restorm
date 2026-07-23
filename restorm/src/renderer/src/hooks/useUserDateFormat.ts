import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useSetting, buildSettingsStorageKey } from 'electron-core-ui/renderer'
import { formatUserDate, type FormatUserDateOptions } from '../utils/dateFormat'

// Computed via `buildSettingsStorageKey` rather than hand-written so this can
// never drift from the key `SettingsService` resolves for the same
// group/id pair (see `hooks/usePushModal.ts` for the same convention).
const DATE_TIME_FORMAT_SETTING_KEY = buildSettingsStorageKey(['behavior'], 'dateTimeFormat')

/**
 * Returns a `formatUserDate` bound to the current `behavior:dateTimeFormat`
 * setting + UI locale. Reads through the shared `SettingsContext` (via
 * `useSetting`), which already subscribes to `onSettingChanged` once for the
 * whole app — so a change made in the Settings panel while the app is
 * running is reflected immediately, without a reload and without this hook
 * opening its own IPC listener per mounted consumer.
 */
export function useUserDateFormat(): {
  formatUserDate: (date: Date, opts?: FormatUserDateOptions) => string
} {
  const { i18n } = useTranslation()
  const [rawValue] = useSetting(DATE_TIME_FORMAT_SETTING_KEY)
  const dateTimeFormat = rawValue === 'iso' ? 'iso' : 'us'

  const bound = useCallback(
    (date: Date, opts?: FormatUserDateOptions): string => formatUserDate(date, dateTimeFormat, i18n.language, opts),
    [dateTimeFormat, i18n.language]
  )

  return { formatUserDate: bound }
}
