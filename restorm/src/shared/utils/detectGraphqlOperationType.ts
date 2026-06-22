/**
 * Detect a GraphQL operation's type (`query` / `mutation` / `subscription`) from
 * its SDL text, so the request panel can adapt the Send button to Subscribe/Stop
 * for a subscription operation without relying on a (possibly stale) stored
 * `operationType` field the user can edit out from under.
 *
 * The detection mirrors how a GraphQL parser reads the leading operation: strip
 * comments + leading whitespace, then look for an explicit `query` / `mutation` /
 * `subscription` keyword introducing the first operation. An anonymous shorthand
 * operation (`{ … }` with no keyword) is a `query` per the spec.
 */

export type GraphQLOperationType = 'query' | 'mutation' | 'subscription'

/**
 * Return the type of the FIRST operation in a GraphQL document, or `query` when
 * the document is empty / shorthand / unparseable (the spec's default).
 */
export function detectGraphqlOperationType(source: string): GraphQLOperationType {
  if (typeof source !== 'string' || source.trim() === '') return 'query'

  // Strip line comments (`# …`) and block strings are irrelevant to the leading
  // keyword; remove `#` comments line-by-line so a commented keyword never wins.
  const withoutComments = source
    .split('\n')
    .map((line) => {
      const hash = line.indexOf('#')
      return hash >= 0 ? line.slice(0, hash) : line
    })
    .join('\n')

  // The first non-whitespace token introduces the operation. Match an explicit
  // operation keyword as a whole word at the start of the trimmed document; a
  // leading `{` (shorthand) or anything else falls through to `query`.
  const match = /^\s*(query|mutation|subscription)\b/i.exec(withoutComments)
  if (match?.[1]) {
    return match[1].toLowerCase() as GraphQLOperationType
  }
  return 'query'
}

/** Convenience: whether the document's first operation is a subscription. */
export function isSubscriptionOperation(source: string): boolean {
  return detectGraphqlOperationType(source) === 'subscription'
}
