/**
 * Stable id for the default (not-yet-persisted) first value row shown on an
 * empty `addToList` / `removeFromList` node, mirroring the object node's default
 * property row. Shared so the box renders the placeholder row under the same id
 * the runtime/preview would resolve it under once the user fills it in.
 */
export const LIST_MUTATION_DEFAULT_VALUE_ID = 'list-mutation-default-value'
