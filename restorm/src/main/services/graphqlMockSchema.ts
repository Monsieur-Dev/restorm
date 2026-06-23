/**
 * Pure (Electron-free) builder for a GraphQL mock server's schema + resolvers.
 *
 * Split out of {@link GraphQLMockServerService} so the resolver-composition
 * logic — canned values from a `Type.field` JSON map, plus an optional scripted
 * resolver — is unit-testable without the main-process / socket plumbing.
 */

import { runInNewContext } from 'node:vm'
import { createSchema, logger } from 'electron-core-ui/main'

/** The executable-schema type, derived from `createSchema` so it resolves
 * through electron-core-ui (restorm doesn't depend on `graphql` directly). */
type MockSchema = ReturnType<typeof createSchema>

/** The resolver shape graphql-yoga's `createSchema` accepts. */
export type ResolverMap = Record<string, Record<string, unknown>>

/** A default schema used when the request carries no SDL, so a freshly created
 * GraphQL mock answers a probe query out of the box. */
export const DEFAULT_MOCK_SCHEMA = 'type Query {\n  hello: String\n}'

/** The GraphQL `subscription` root type name(s) declared in an SDL. The SDL may
 * rename the root via `schema { subscription: X }`; absent that, the default
 * name is `Subscription`. Returned lower-cased keys aren't needed — we match the
 * exact type names so a canned `<Sub>.field` resolver is built subscription-shaped. */
export function subscriptionTypeNames(sdl: string | undefined): Set<string> {
  const names = new Set<string>()
  if (!sdl || sdl.trim() === '') return names
  // Strip block + line comments so a `# subscription: …` note can't false-match.
  const stripped = sdl.replace(/"""[\s\S]*?"""/g, '').replace(/#[^\n]*/g, '')
  // An explicit `schema { … subscription: Foo … }` operation-type mapping.
  const schemaBlock = /\bschema\b[^{]*\{([\s\S]*?)\}/.exec(stripped)
  if (schemaBlock) {
    const m = /\bsubscription\s*:\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(schemaBlock[1])
    if (m) names.add(m[1])
  }
  // The conventional default root, present whenever a `type Subscription { … }`
  // is declared (even without an explicit schema block).
  if (/\btype\s+Subscription\b/.test(stripped)) names.add('Subscription')
  return names
}

/** Wrap a canned value as a one-shot subscription resolver: graphql requires a
 * Subscription field to return `{ subscribe: () => AsyncIterable, resolve }`,
 * not a plain value (a `() => value` resolver yields `undefined` →
 * "Subscription field must return Async Iterable"). The mock emits the canned
 * value ONCE then completes the stream, so a no-script canned subscription
 * streams out of the box. */
function cannedSubscriptionResolver(field: string, value: unknown): { subscribe: () => AsyncIterable<unknown>; resolve: (payload: unknown) => unknown } {
  return {
    // A hand-rolled AsyncIterable that yields the canned payload exactly once
    // then completes — avoids an async-generator-with-no-await (cleaner than a
    // `Promise.resolve`-padded one) while satisfying graphql's iterator contract.
    subscribe: () => {
      let emitted = false
      return {
        [Symbol.asyncIterator](): AsyncIterator<unknown> {
          return {
            next: (): Promise<IteratorResult<unknown>> => {
              if (emitted) return Promise.resolve({ value: undefined, done: true })
              emitted = true
              return Promise.resolve({ value: { [field]: value }, done: false })
            },
            return: (): Promise<IteratorResult<unknown>> => {
              emitted = true
              return Promise.resolve({ value: undefined, done: true })
            }
          }
        }
      }
    },
    resolve: (payload: unknown) => (payload as Record<string, unknown>)[field]
  }
}

/** Parse a `mockResolvers` JSON object (`{ "Query.pets": [...] }`) into a
 * resolver map of constant-returning functions. A field on a Subscription root
 * type (per the SDL) is built as a proper `{ subscribe, resolve }` resolver
 * emitting the canned value, NOT a plain value resolver. Malformed JSON is
 * logged + ignored (the mock still serves with schema defaults). */
export function parseCannedResolvers(mockResolvers?: string, sdl?: string): ResolverMap {
  if (!mockResolvers || mockResolvers.trim() === '') return {}
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(mockResolvers) as Record<string, unknown>
  } catch (err) {
    logger.warn('[GraphQLMockServer] mockResolvers is not valid JSON — ignoring', { error: String(err) })
    return {}
  }
  const subscriptionTypes = subscriptionTypeNames(sdl)
  const out: ResolverMap = {}
  for (const [key, value] of Object.entries(parsed)) {
    const dot = key.indexOf('.')
    if (dot <= 0) continue
    const typeName = key.slice(0, dot)
    const field = key.slice(dot + 1)
    out[typeName] = out[typeName] ?? {}
    out[typeName][field] = subscriptionTypes.has(typeName)
      ? cannedSubscriptionResolver(field, value)
      : () => value
  }
  return out
}

/** Parse a scripted resolver body. The script runs in a Function sandbox and
 * must return a resolver map (`{ Query: { pets: (parent,args,ctx) => … } }`); a
 * `pubsub` is injected so subscription resolvers can be driven. A throwing /
 * non-object script is logged + ignored. */
export function parseScriptedResolvers(resolverScript: string | undefined, pubsub: unknown): ResolverMap {
  if (!resolverScript || resolverScript.trim() === '') return {}
  try {
    // The script body is wrapped in a function expression and evaluated in a
    // fresh V8 context (`node:vm`) with `pubsub` injected, so subscription
    // resolvers can drive a topic. The function-expression wrapper lets the
    // body `return` its resolver map directly.
    const result: unknown = runInNewContext(
      `(function (pubsub) {\n"use strict";\n${resolverScript}\n})(pubsub)`,
      { pubsub }
    )
    if (result && typeof result === 'object') return result as ResolverMap
    logger.warn('[GraphQLMockServer] resolverScript did not return a resolver object — ignoring')
    return {}
  } catch (err) {
    logger.warn('[GraphQLMockServer] resolverScript threw at build time — ignoring', { error: String(err) })
    return {}
  }
}

/** Merge canned + scripted resolver maps (scripted overrides canned per field). */
export function mergeResolvers(canned: ResolverMap, scripted: ResolverMap): ResolverMap {
  const out: ResolverMap = {}
  for (const source of [canned, scripted]) {
    for (const [typeName, fields] of Object.entries(source)) {
      out[typeName] = { ...(out[typeName] ?? {}), ...fields }
    }
  }
  return out
}

/** Build the executable GraphQL schema for a mock server from its SDL + the
 * composed resolver map. Introspection is always available (graphql-yoga keeps
 * it on by default at serve time). */
export function buildMockSchema(input: {
  schema?: string
  mockResolvers?: string
  resolverScript?: string
  pubsub?: unknown
}): MockSchema {
  const typeDefs = input.schema && input.schema.trim() !== '' ? input.schema : DEFAULT_MOCK_SCHEMA
  const resolvers = mergeResolvers(
    // Pass the SDL so canned resolvers on a Subscription root type are built
    // as `{ subscribe, resolve }` AsyncIterables, not plain value resolvers.
    parseCannedResolvers(input.mockResolvers, typeDefs),
    parseScriptedResolvers(input.resolverScript, input.pubsub)
  )
  return createSchema({ typeDefs, resolvers })
}
