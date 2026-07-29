/**
 * Locale pinned for every Electron launch under test.
 *
 * The i18n bootstrap defaults the UI language to the OS locale whenever the
 * user has never explicitly chosen one — which is the state of every test
 * run, since each launch gets a throwaway userData dir. Inheriting the
 * host's locale would therefore run a suite in whatever language the
 * developer's machine happens to use while CI runs it in another, silently
 * changing every user-visible string the specs assert on. Pinning makes the
 * language a property of the suite rather than of the machine.
 *
 * `LC_*` must be dropped rather than merely overridden: a host that sets
 * only `LC_MESSAGES`/`LC_NUMERIC` (a common "English UI, local formats"
 * setup) would otherwise keep steering Chromium's locale resolution.
 */
const E2E_LOCALE_ENV = {
  LANG: 'en_US.UTF-8',
  LANGUAGE: 'en_US:en',
  LC_ALL: 'en_US.UTF-8'
} as const

/**
 * Build the environment for an `electron.launch` under test: the inherited
 * environment with its locale replaced by {@link E2E_LOCALE_ENV}.
 *
 * Returns `Record<string, string>` rather than `NodeJS.ProcessEnv` because
 * that is what Playwright's `launch({ env })` accepts — a `ProcessEnv`
 * admits `undefined` values and is not assignable to it. Unset variables are
 * dropped rather than forwarded, which is also what actually happens to
 * them: a spawned process cannot inherit a variable that has no value.
 *
 * @param env The environment to derive from, usually `process.env`.
 * @param overrides Extra variables applied on top (they win over the pin).
 */
export function withE2ELocaleEnv(
  env: NodeJS.ProcessEnv,
  overrides: NodeJS.ProcessEnv = {}
): Record<string, string> {
  const result: Record<string, string> = {}

  for (const [key, value] of Object.entries(env)) {
    const isLocaleVar = key.startsWith('LC_') || key === 'LANG' || key === 'LANGUAGE'
    if (value !== undefined && !isLocaleVar) {
      result[key] = value
    }
  }

  Object.assign(result, E2E_LOCALE_ENV)

  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) {
      result[key] = value
    }
  }

  return result
}
