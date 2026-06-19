import { z } from 'zod'
import { logger, validatedHandle } from 'electron-core-ui'
import { graphQLService } from 'electron-core-ui/main'
import { typeDefs, resolvers, pubsub } from './graphql'

/** Args schema for the `graphql:query` IPC — a single { query, variables? }
 * object. Validated rather than trusted so a malformed renderer payload can't
 * feed a non-string into the GraphQL POST body. */
const graphqlQueryArgs = z.tuple([
  z.object({
    query: z.string(),
    variables: z.record(z.string(), z.unknown()).optional()
  })
])

/**
 * Initialize and start the GraphQL service, and register the graphql:query IPC handler.
 */
export function setupGraphQL(): void {
  graphQLService.initialize({
    typeDefs,
    resolvers,
    pubsub,
    // `port: 0` asks the OS for a free ephemeral port. Two restorm
    // instances on the same machine no longer collide on a fixed
    // 4123. The renderer reads the live endpoint via the
    // `runtime:get-config` IPC.
    port: 0,
    context: () => ({
      pubsub
    })
  })
  void graphQLService.start().then(() => {
    logger.info('GraphQL Service started', { endpoint: graphQLService.getEndpoint() })
  }).catch((error: unknown) => {
    logger.error('Failed to start GraphQL Service', { error: String(error) })
  })

  validatedHandle('graphql:query', graphqlQueryArgs, async (_event, [input]) => {
    const response = await fetch(graphQLService.getEndpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: input.query,
        variables: input.variables
      })
    })

    if (!response.ok) {
      throw new Error(`GraphQL request failed: ${response.status}`)
    }

    const result: unknown = await response.json()
    return result
  })
}
