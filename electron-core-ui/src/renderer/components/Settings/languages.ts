export interface AvailableLanguage {
  code: string
  name: string
}

/**
 * Available languages for the application. Each entry's `name` is the
 * endonym (the language's name in its own tongue) so any dropdown built
 * from this list always reads natively for the user picking from it.
 * Shared by the app-wide language switcher ({@link SettingsPage}) and any
 * other generic component needing the same language set (e.g.
 * `PushModal`'s commit-message-language picker) — kept in its own
 * data-only file so importing it doesn't drag a component module along
 * for the ride.
 */
export const AVAILABLE_LANGUAGES: AvailableLanguage[] = [
  { code: 'en', name: 'English' },
  { code: 'fr', name: 'Français' },
  { code: 'es', name: 'Español' },
  { code: 'de', name: 'Deutsch' },
  { code: 'it', name: 'Italiano' },
  { code: 'pt', name: 'Português' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'sv', name: 'Svenska' },
  { code: 'da', name: 'Dansk' },
  { code: 'nb', name: 'Norsk bokmål' },
  { code: 'fi', name: 'Suomi' },
  { code: 'pl', name: 'Polski' },
  { code: 'cs', name: 'Čeština' },
  { code: 'hu', name: 'Magyar' },
  { code: 'ro', name: 'Română' },
  { code: 'el', name: 'Ελληνικά' },
  { code: 'uk', name: 'Українська' },
  { code: 'hr', name: 'Hrvatski' },
  { code: 'sr', name: 'Srpski' },
  { code: 'sq', name: 'Shqip' },
  { code: 'tr', name: 'Türkçe' },
  { code: 'id', name: 'Bahasa Indonesia' },
  { code: 'vi', name: 'Tiếng Việt' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'zh-CN', name: '简体中文' },
  { code: 'zh-TW', name: '繁體中文' }
]
