/**
 * The languages the scenario `code` node can run, each backed by its own
 * WASM runtime (see `src/main/scenarioEngine/codeRuntimes`). This list is the
 * single source of truth shared by the box UI (the language radio + Monaco
 * mode) and the main-process runtime registry. A language only appears here
 * once its runtime is wired, so the selector never offers a dead option.
 *
 * Ordered TS/JS first (the original default), then the additional runtimes.
 */
export const CODE_LANGUAGES = ['typescript', 'javascript', 'python', 'lua', 'ruby', 'r'] as const

export type CodeLanguage = (typeof CODE_LANGUAGES)[number]

/** Human label per language (shown on the radio). */
export const CODE_LANGUAGE_LABELS: Record<CodeLanguage, string> = {
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  python: 'Python',
  lua: 'Lua',
  ruby: 'Ruby',
  r: 'R'
}

/** The original default — a `code` node with no `config.language` runs as
 * TypeScript (so existing nodes keep their behaviour without a persisted key). */
export const DEFAULT_CODE_LANGUAGE: CodeLanguage = 'typescript'

export function isCodeLanguage(v: unknown): v is CodeLanguage {
  return typeof v === 'string' && (CODE_LANGUAGES as readonly string[]).includes(v)
}
