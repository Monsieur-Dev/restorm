import Handlebars from 'handlebars'

/** Minimal structural views of the Handlebars AST nodes this resolver mutates.
 * `@types/handlebars` exposes them via the ambient `hbs` global, which the
 * lint type-service resolves inconsistently — these local shapes keep the
 * member access fully typed regardless. */
interface PathNode {
  type: string
  parts: string[]
  depth: number
  data: boolean
}
interface MustacheNode {
  path: PathNode
  params: unknown[]
  hash?: { pairs?: unknown[] }
}

/**
 * Resolve a Handlebars template against a variable context, giving CONTEXT
 * VARIABLES priority over registered helpers that share their name.
 *
 * Restorm registers a large helper suite (`min`, `max`, `test`, `trim`, `add`,
 * …) on the global Handlebars. A bare mustache `{{name}}` is helper-eligible,
 * so a user variable named like a helper gets shadowed: `{{min}}` invokes the
 * `min` helper (→ silent wrong value, or a throw) instead of reading the
 * variable. This resolver rewrites a bare, argument-less `{{name}}` to the
 * context-forced form `{{this.[name]}}` — but ONLY when `name` is BOTH a
 * context key AND a registered helper (a genuine collision). Everything else
 * compiles byte-for-byte unchanged:
 *   - helper calls with args (`{{min a b}}`) or a hash (`{{min k=v}}`)
 *   - block helpers (`{{#if}}`, `{{#each}}`, `{{else}}`)
 *   - subexpressions (`(min)` — always an explicit call, never a variable)
 *   - dotted / `@data` / `this` paths (`{{a.b}}`, `{{@index}}`, `{{this.x}}`)
 *
 * Disambiguation rule: 0 args ⇒ variable, ≥1 arg ⇒ helper. So `{{min}}` reads
 * the variable while `{{min min}}` still calls the helper on it.
 *
 * Compile errors propagate to the caller (mirroring `Handlebars.compile`); a
 * parse failure during the rewrite falls back to compiling the original
 * template untouched.
 */
export function resolveWithContextPriority(
  template: string,
  context: Record<string, unknown>,
  hb: typeof Handlebars = Handlebars
): string {
  if (!template.includes('{{')) return template

  // Cheap gate: only pay the parse/visit cost when a context key actually
  // collides with a registered helper name. The overwhelmingly common case
  // (no collision) compiles exactly as before.
  const hasCollision = Object.keys(context).some((key) =>
    Object.prototype.hasOwnProperty.call(hb.helpers, key)
  )

  if (hasCollision) {
    let ast: ReturnType<typeof hb.parse>
    try {
      ast = hb.parse(template)
    } catch {
      // Genuine syntax error — fall through to the plain compile below, which
      // re-throws the same error so the caller (which logs + returns the raw
      // value) handles it exactly as it did before this resolver existed.
      return hb.compile(template, { noEscape: true })(context)
    }
    // Parse succeeded: DON'T swallow a rewrite/compile failure into a plain
    // compile of the original — that would silently return the helper-shadowed
    // value this resolver exists to prevent. Let it propagate to the caller's
    // try/catch (logged) instead.
    new ContextPriorityVisitor(hb, context).accept(ast)
    return hb.compile(ast, { noEscape: true })(context)
  }

  return hb.compile(template, { noEscape: true })(context)
}

/**
 * Walks the AST and, for every top-level (non-subexpression) bare mustache
 * whose single-segment name collides with a registered helper AND exists in
 * the context, swaps its path for a `{{this.[name]}}` path so the compiler
 * resolves it from the context instead of dispatching to the helper.
 *
 * Only `MustacheStatement` is overridden: subexpressions `(name)` are explicit
 * helper invocations by syntax and must keep dispatching to the helper. Block
 * statements are traversed (so a collision inside `{{#if}}…{{/if}}` is fixed)
 * but their own path (the block helper) is never a no-arg mustache.
 */
class ContextPriorityVisitor extends Handlebars.Visitor {
  constructor(
    private readonly hb: typeof Handlebars,
    private readonly context: Record<string, unknown>
  ) {
    super()
  }

  MustacheStatement(mustache: hbs.AST.MustacheStatement): void {
    this.forceContextLookup(mustache as unknown as MustacheNode)
    super.MustacheStatement(mustache)
  }

  /** Apply the collision rewrite in place on a single mustache node. */
  private forceContextLookup(mustache: MustacheNode): void {
    const path = mustache.path
    const hashPairs = mustache.hash?.pairs
    if (
      path.type !== 'PathExpression' ||
      mustache.params.length !== 0 ||
      (hashPairs !== undefined && hashPairs.length !== 0) ||
      path.parts.length !== 1 ||
      path.depth !== 0 ||
      path.data
    ) {
      return
    }

    const name = path.parts[0]
    if (
      name === undefined ||
      name.includes(']') ||
      name.includes('\n') ||
      !Object.prototype.hasOwnProperty.call(this.context, name) ||
      !Object.prototype.hasOwnProperty.call(this.hb.helpers, name)
    ) {
      return
    }

    // Reparse a known-good context path and graft its PathExpression in.
    // `{{this.[name]}}` keeps `parts === [name]` but its `original`
    // (`this.[name]`) marks it non-helper-eligible to the compiler.
    const reparsed = this.hb.parse(`{{this.[${name}]}}`).body[0] as unknown as MustacheNode | undefined
    if (reparsed !== undefined) {
      mustache.path = reparsed.path
    }
  }
}
