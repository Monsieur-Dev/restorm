/**
 * `yaml.load` with js-yaml v4's contract for EMPTY input.
 *
 * js-yaml v5 throws `expected a document, but the input is empty` on an empty
 * (or whitespace/comment-only) string, where v4 returned `undefined`. Every
 * caller here parses file content that can legitimately be empty — a fresh
 * settings file, a just-created project, a theme stub — and treats "no
 * document" as a normal state, not an error. This wrapper restores that
 * contract in ONE place instead of ten call sites growing their own guard.
 *
 * Anything else (real syntax errors included) still propagates from the
 * parser untouched.
 */

import * as yaml from 'js-yaml'

/** Message prefix js-yaml v5 uses for the empty-input rejection. */
const EMPTY_INPUT_MESSAGE = 'expected a document, but the input is empty'

export function loadYamlDocument(content: string, options?: yaml.LoadOptions): unknown {
  try {
    return yaml.load(content, options)
  } catch (error) {
    // `typeof` guard: a unit test that mocks `js-yaml` with just `load` leaves
    // `YAMLException` undefined, and `instanceof undefined` would itself throw.
    if (
      typeof yaml.YAMLException === 'function' &&
      error instanceof yaml.YAMLException &&
      error.reason === EMPTY_INPUT_MESSAGE
    ) {
      return undefined
    }
    throw error
  }
}
