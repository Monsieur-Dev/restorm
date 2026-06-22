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

/** Parse a `mockResolvers` JSON object (`{ "Query.pets": [...] }`) into a
 * resolver map of constant-returning functions. Malformed JSON is logged +
 * ignored (the mock still serves with schema defaults). */
export function parseCannedResolvers(mockResolvers?: string): ResolverMap {
  if (!mockResolvers || mockResolvers.trim() === '') return {}
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(mockResolvers) as Record<string, unknown>
  } catch (err) {
    logger.warn('[GraphQLMockServer] mockResolvers is not valid JSON — ignoring', { error: String(err) })
    return {}
  }
  const out: ResolverMap = {}
  for (const [key, value] of Object.entries(parsed)) {
    const dot = key.indexOf('.')
    if (dot <= 0) continue
    const typeName = key.slice(0, dot)
    const field = key.slice(dot + 1)
    out[typeName] = out[typeName] ?? {}
    out[typeName][field] = () => value
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
    parseCannedResolvers(input.mockResolvers),
    parseScriptedResolvers(input.resolverScript, input.pubsub)
  )
  return createSchema({ typeDefs, resolvers })
}
