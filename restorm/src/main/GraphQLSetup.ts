import { ipcMain } from 'electron'
import { logger } from 'electron-core-ui'
import { graphQLService } from 'electron-core-ui/main'
import { typeDefs, resolvers, pubsub } from './graphql'

/**
 * Initialize and start the GraphQL service, and register the graphql:query IPC handler.
 */
export function setupGraphQL(): void {
  graphQLService.initialize({
    typeDefs,
    resolvers,
    pubsub,
    port: 4123, // Use non-standard port to avoid conflicts
    context: () => ({
      pubsub
    })
  })
  void graphQLService.start().then(() => {
    logger.info('GraphQL Service started', { endpoint: graphQLService.getEndpoint() })
  }).catch((error: unknown) => {
    logger.error('Failed to start GraphQL Service', { error: String(error) })
  })

  ipcMain.handle('graphql:query', async (_event, input: { query: string; variables?: Record<string, unknown> }) => {
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
