import type { ScenarioConnectionRef, ConnectionPickerKind } from './scenarioConnectionsContext'

/**
 * The connections a close/send picker offers, given the transport `kind` and an
 * optional server/client split.
 *
 * - `serverOnly === undefined` → every connection of that transport (a send node,
 *   or a close whose transport has a single connection abstraction).
 * - `serverOnly === true` → hosted-server connections only (a WS/SIO server close).
 * - `serverOnly === false` → client connections only (a WS/SIO client close).
 *
 * RETRO-COMPAT: a persisted `selectedId` that resolves to an OUT-OF-CATEGORY
 * connection (e.g. a legacy client-close node pointing at a server connection, or
 * vice-versa) is still appended so the picker keeps DISPLAYING the current
 * selection — it is simply no longer offered for a NEW pick. This keeps existing
 * scenarios valid on load (the executor already handles either target); the split
 * only guides fresh authoring.
 */
export function filterPickerConnections(
  connections: readonly ScenarioConnectionRef[],
  kind: ConnectionPickerKind,
  serverOnly: boolean | undefined,
  selectedId: string
): ScenarioConnectionRef[] {
  const all = connections.filter((c) => c.kind === kind)
  const inCategory = serverOnly === undefined
    ? all
    : all.filter((c) => (c.isServer ?? false) === serverOnly)
  const selected = selectedId !== '' ? all.find((c) => c.id === selectedId) : undefined
  return selected && !inCategory.some((c) => c.id === selected.id)
    ? [...inCategory, selected]
    : inCategory
}
