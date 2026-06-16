import { createContext, useContext } from 'react'

/**
 * The Socket.IO connections declared in the current scenario — one entry per
 * `socketioConnect` node, `{ id, name }`. The editor provides it so a
 * `socketioSend` / `socketioClose` box can offer a connection picker that stays
 * in sync as connect nodes are added / renamed / deleted (the implicit link the
 * send/close nodes reference by node id, displayed by the connect node's name).
 *
 * Empty (no provider) when a box renders outside the editor — the picker then
 * shows just its persisted reference.
 */
export interface ScenarioConnectionRef {
  id: string
  name: string
  /** The connect node's kind — a send/close picker shows only its own transport's
   * connections (`socketioConnect` vs `websocketConnect` vs `grpcConnect`). */
  kind: 'socketioConnect' | 'websocketConnect' | 'grpcConnect' | 'mqttConnect'
  /** The connect node's linked request event — pre-fills a send node's channel. */
  defaultChannel?: string
  /** The connect node's linked request message — pre-fills a send node's payload. */
  defaultPayload?: string
}

export const ScenarioConnectionsContext = createContext<ScenarioConnectionRef[]>([])

export function useScenarioConnections(): ScenarioConnectionRef[] {
  return useContext(ScenarioConnectionsContext)
}
