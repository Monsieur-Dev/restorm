/**
 * GraphQL module for Restorm
 *
 * Exports schema, resolvers, and initialization functions
 */

import { generateRestormSchema } from './schemaConfig'

export const typeDefs = generateRestormSchema()
export { resolvers, setCollectionsStore, getCollectionsStore } from './resolvers'
export { pubsub, PUBSUB_TOPICS } from '../services/CollectionStore'
