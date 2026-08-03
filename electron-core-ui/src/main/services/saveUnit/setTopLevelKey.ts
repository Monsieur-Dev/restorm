/**
 * Add one top-level key to a serialized document **without** reparsing
 * and re-serializing it.
 *
 * The obvious implementation — `serialize({ ...deserialize(raw), key })` —
 * is lossy in every format this library persists, and the loss is
 * invisible until someone reopens their file:
 *
 * - YAML: `js-yaml` has no comment round-trip, so every comment is
 *   discarded. `noRefs` expands anchors and aliases into duplicated
 *   literal content, irreversibly flattening a file that used `&x`/`*x`
 *   to share configuration. Quoting, indentation and scalar style are
 *   all renormalised.
 * - JSON5: comments are part of the format and `JSON5.stringify` drops
 *   them.
 * - JSON: no comments to lose, but key order and formatting still churn.
 *
 * Rewriting a document the user hand-authored, as a side effect of an
 * operation they experienced as opening it, is not a trade this library
 * gets to make. So the key goes in as *text*, leaving every byte around
 * it alone.
 *
 * Safety is not assumed: {@link setTopLevelKey} re-parses its own output
 * and hands back `null` unless the result is exactly the original value
 * with the one key set. A caller that gets `null` must leave the file
 * untouched — never fall back to the round-trip.
 */

import { deserialize, type PersistenceFormat } from '../PersistenceService'

/**
 * Return `raw` with the top-level `key` set to `value`, or `null` when
 * that cannot be done safely.
 *
 * `value` may be a string or a number. The distinction is not cosmetic:
 * the round-trip check below compares the re-parsed value with `value`
 * using `!==`, so a numeric key written as the string `'1'` would parse
 * back as the number `1` and the insertion would be refused. Documents
 * carry both kinds of top-level scalar — an identity is a string, a
 * format version is a number.
 *
 * Two shapes are handled, and only two:
 * - the key is **absent** → it is appended / inserted at the top level;
 * - the key is present but **blank** (`key: ''`, or `key:` with no value
 *   at all) → that value is replaced in place. This is the
 *   blank-identity case, and refusing it would leave such a document
 *   without a usable identity forever, since the key cannot be inserted
 *   a second time.
 *
 * A key holding any real value is never overwritten — that would be
 * destroying data rather than filling a gap.
 *
 * `null` is returned for document shapes a textual edit cannot reason
 * about — a sequence or scalar at the root, a flow-style root (`{ … }`
 * in YAML), a multi-document YAML stream — and for any result that fails
 * the round-trip check. In every one of those cases the correct
 * behaviour is to leave the file as it is.
 */
export function setTopLevelKey(
  raw: string,
  key: string,
  value: string | number,
  format: PersistenceFormat
): string | null {
  const existing = readExistingValue(raw, key, format)
  if (existing === UNREADABLE) return null

  const candidate =
    existing === ABSENT
      ? format === 'yaml'
        ? insertYamlKey(raw, key, value)
        : insertJsonLikeKey(raw, key, value)
      : replaceEmptyValue(raw, key, value, format)

  if (candidate === null) return null
  return verify(raw, candidate, key, value, format) ? candidate : null
}

/** The key is not present at all. */
const ABSENT = Symbol('absent')
/** The document could not be parsed, or its root is not a mapping. */
const UNREADABLE = Symbol('unreadable')

function readExistingValue(raw: string, key: string, format: PersistenceFormat): unknown {
  let parsed: unknown
  try {
    parsed = deserialize(raw, format)
  } catch {
    return UNREADABLE
  }
  // An empty document is a mapping waiting to happen.
  if (parsed === null || parsed === undefined) return ABSENT
  if (!isPlainObject(parsed)) return UNREADABLE
  if (!Object.prototype.hasOwnProperty.call(parsed, key)) return ABSENT
  const current = parsed[key]
  // Only a blank slot may be filled; anything else is real data. YAML
  // spells a valueless key as `null` (`key:`) and an explicitly empty
  // one as `''` — both are the same blank slot to a reader.
  return current === '' || current === null ? '' : UNREADABLE
}

/**
 * Replace an empty top-level value in place. The pattern is anchored at
 * column 0 so it can only match a top-level key of a block mapping, and
 * the round-trip check still has the last word.
 */
function replaceEmptyValue(raw: string, key: string, value: string | number, format: PersistenceFormat): string | null {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern =
    format === 'yaml'
      ? new RegExp(`^(${escapedKey}[ \\t]*:[ \\t]*)(''|""|)[ \\t]*$`, 'm')
      : new RegExp(`^([ \\t]*(?:"${escapedKey}"|'${escapedKey}'|${escapedKey})[ \\t]*:[ \\t]*)(''|"")`, 'm')

  const matches = raw.match(new RegExp(pattern.source, 'gm'))
  // More than one candidate line means the anchor is not identifying a
  // single top-level slot; refuse rather than pick one.
  if (matches?.length !== 1) return null

  const replacement = format === 'yaml' ? yamlScalar(value) : JSON.stringify(value)
  return raw.replace(pattern, (_full, prefix: string) => {
    // `key:` with nothing after it is a valid blank slot, but `key:value`
    // is not a mapping at all — YAML needs the separating space. Normalise
    // the captured prefix rather than trusting it to already have one.
    const spaced = format === 'yaml' ? `${prefix.replace(/[ \t]*$/, '')} ` : prefix
    return `${spaced}${replacement}`
  })
}

/**
 * Append `key: value` at column 0. In a block-style mapping that closes
 * every open nested block and lands the key at the top level, which is
 * why the insertion goes at the end rather than trying to find a spot
 * inside the document.
 */
function insertYamlKey(raw: string, key: string, value: string | number): string | null {
  // A multi-document stream would take the key into its LAST document
  // rather than the one the caller means. A single leading `---` is
  // fine — that is still one document — but a second marker, or an
  // explicit end-of-document `...`, means more than one.
  const starts = raw.match(/^---(\s|$)/gm)?.length ?? 0
  if (starts > 1) return null
  if (/^\.\.\.(\s|$)/m.test(raw)) return null

  const body = raw.replace(/\s+$/, '')
  // An empty document has no mapping to extend, but starting one is
  // unambiguous.
  if (body.length === 0) return `${key}: ${yamlScalar(value)}\n`

  return `${body}\n${key}: ${yamlScalar(value)}\n`
}

/**
 * Insert `"key": value` immediately after the opening brace, keeping the
 * rest of the text — including any comments in a JSON5 document —
 * exactly where it was.
 */
function insertJsonLikeKey(raw: string, key: string, value: string | number): string | null {
  const open = raw.indexOf('{')
  if (open === -1) return null
  // Anything before the first brace that isn't whitespace means the root
  // is not a plain object (or the file starts with something this
  // function should not be touching).
  if (raw.slice(0, open).trim().length > 0) return null

  const rest = raw.slice(open + 1)
  const entry = `${JSON.stringify(key)}: ${JSON.stringify(value)}`
  // An empty object takes the key with no separator; anything else needs
  // a comma before the existing first member.
  const isEmpty = rest.trimStart().startsWith('}')
  const separator = isEmpty ? '' : ','
  return `${raw.slice(0, open + 1)}\n  ${entry}${separator}${rest}`
}

/**
 * A YAML scalar for the value we are about to write.
 *
 * A number is emitted bare — quoting it would make it parse back as a
 * string and the round-trip check would (correctly) refuse the result.
 * A string we emit is UUID-shaped, but quote defensively anyway.
 */
function yamlScalar(value: string | number): string {
  if (typeof value === 'number') return JSON.stringify(value)
  return /^[A-Za-z0-9_.-]+$/.test(value) ? value : JSON.stringify(value)
}

/**
 * The insertion is only accepted when re-parsing proves it changed
 * exactly one thing. This is what makes a textual edit safe to apply to
 * a file nobody has validated: a mistake becomes a refusal, never a
 * corrupted document.
 */
function verify(raw: string, candidate: string, key: string, value: string | number, format: PersistenceFormat): boolean {
  let before: unknown
  let after: unknown
  try {
    before = deserialize(raw, format)
    after = deserialize(candidate, format)
  } catch {
    return false
  }

  if (!isPlainObject(after)) return false
  if (after[key] !== value) return false

  // The original may be an empty document; anything else must be a plain
  // object whose entries survived untouched.
  const expected: Record<string, unknown> =
    before === null || before === undefined ? {} : isPlainObject(before) ? before : NOT_AN_OBJECT

  if (expected === NOT_AN_OBJECT) return false

  const keyPreexisted = Object.prototype.hasOwnProperty.call(expected, key)
  // The only pre-existing values that may be overwritten are blanks.
  if (keyPreexisted && expected[key] !== '' && expected[key] !== null) return false

  const afterKeys = Object.keys(after)
  const grew = keyPreexisted ? 0 : 1
  if (afterKeys.length !== Object.keys(expected).length + grew) return false

  // Every OTHER entry must have survived byte-for-byte in meaning.
  return Object.entries(expected)
    .filter(([k]) => k !== key)
    .every(([k, v]) => deepEqual(after[k], v))
}

/** Sentinel distinguishing "root wasn't an object" from a legitimate `{}`. */
const NOT_AN_OBJECT: Record<string, unknown> = {}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Structural comparison. `JSON.stringify` would be shorter but is
 * key-order sensitive, and the whole point of a textual insertion is
 * that it does not disturb order — so a false negative here would
 * reject a perfectly good edit.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, i) => deepEqual(item, b[i]))
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ao = a as Record<string, unknown>
    const bo = b as Record<string, unknown>
    const aKeys = Object.keys(ao)
    if (aKeys.length !== Object.keys(bo).length) return false
    return aKeys.every((k) => Object.prototype.hasOwnProperty.call(bo, k) && deepEqual(ao[k], bo[k]))
  }
  // NaN is the only remaining value that is not `===` itself.
  return Number.isNaN(a) && Number.isNaN(b)
}
