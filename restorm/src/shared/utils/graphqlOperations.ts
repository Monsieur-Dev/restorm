/**
 * Lightweight extraction of the named operations declared in a GraphQL
 * document, without pulling in the `graphql` package (which is not a
 * direct restorm dependency and is not bundled into the renderer).
 *
 * GraphQL-over-HTTP requires an `operationName` when a single document
 * declares more than one operation, so the UI needs the list of names to
 * offer a selector. We only need the operation *names* here — a full
 * AST parse would be overkill and would force a new dependency — so we
 * tokenise the document enough to skip strings/comments and then match
 * top-level `query` / `mutation` / `subscription` definitions.
 */

/** A named operation declared in a GraphQL document. */
export interface GraphQLNamedOperation {
  /** Operation keyword (`query` | `mutation` | `subscription`). */
  operationType: 'query' | 'mutation' | 'subscription'
  /** The operation name (the identifier after the keyword). */
  name: string
}

/**
 * Strip comments and string/block-string literals from a GraphQL document
 * so the operation-definition scan never trips over `#`, `"..."` or
 * `"""..."""` content that happens to contain the operation keywords.
 */
function stripCommentsAndStrings(document: string): string {
  let out = ''
  let i = 0
  const n = document.length
  while (i < n) {
    // `charAt` always returns a string (empty past the end), so the
    // accumulator below never sees `undefined` under noUncheckedIndexedAccess.
    const ch = document.charAt(i)
    // Line comment: `# ...` until end of line.
    if (ch === '#') {
      while (i < n && document[i] !== '\n') i++
      continue
    }
    // Block string: `""" ... """`.
    if (ch === '"' && document.slice(i, i + 3) === '"""') {
      i += 3
      while (i < n && document.slice(i, i + 3) !== '"""') i++
      i += 3
      out += ' '
      continue
    }
    // Plain string: `"..."` (with escape handling).
    if (ch === '"') {
      i++
      while (i < n && document[i] !== '"') {
        if (document[i] === '\\') i++
        i++
      }
      i++
      out += ' '
      continue
    }
    out += ch
    i++
  }
  return out
}

/**
 * Parse the named operations declared in a GraphQL document, in source
 * order. Anonymous operations (e.g. a bare `{ ... }` shorthand query, or
 * `query { ... }` with no name) are skipped because they cannot be
 * referenced by `operationName`.
 */
export function parseGraphQLOperations(document: string): GraphQLNamedOperation[] {
  if (!document) return []
  const cleaned = stripCommentsAndStrings(document)
  const operations: GraphQLNamedOperation[] = []
  // `query`/`mutation`/`subscription` as a standalone word, followed by an
  // operation name identifier. The leading boundary keeps `subscription`
  // from matching inside a field name; the name group requires an actual
  // identifier so anonymous operations don't produce an empty entry.
  const re = /(^|[^A-Za-z0-9_])(query|mutation|subscription)\s+([A-Za-z_][A-Za-z0-9_]*)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(cleaned)) !== null) {
    const operationType = match[2] as GraphQLNamedOperation['operationType']
    const name = match[3]
    if (name) {
      operations.push({ operationType, name })
    }
  }
  return operations
}

/**
 * Convenience accessor: just the operation names, in source order.
 */
export function parseGraphQLOperationNames(document: string): string[] {
  return parseGraphQLOperations(document).map((op) => op.name)
}
