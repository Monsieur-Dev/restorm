import { describe, it, expect } from 'vitest'
import { filterPickerConnections } from './scenarioConnectionsFilter'
import type { ScenarioConnectionRef } from './scenarioConnectionsContext'

/**
 * The picker filter splits a transport's connections into server vs client so a
 * server-close node offers only hosted servers and a client close only clients —
 * while a persisted out-of-category selection stays visible (retro-compat, so an
 * existing scenario whose client close targets a server isn't shown as dangling).
 */

const conns: ScenarioConnectionRef[] = [
  { id: 'wsClient', name: 'Echo', kind: 'websocketConnect' },
  { id: 'wsServer', name: 'Mock', kind: 'websocketConnect', isServer: true },
  { id: 'sioClient', name: 'Chat', kind: 'socketioConnect' },
  { id: 'sioServer', name: 'Hub', kind: 'socketioConnect', isServer: true }
]

const ids = (list: ScenarioConnectionRef[]): string[] => list.map((c) => c.id)

describe('filterPickerConnections', () => {
  it('server-close (serverOnly=true) lists only server-bound connections of the kind', () => {
    expect(ids(filterPickerConnections(conns, 'websocketConnect', true, ''))).toEqual(['wsServer'])
    expect(ids(filterPickerConnections(conns, 'socketioConnect', true, ''))).toEqual(['sioServer'])
  })

  it('client close (serverOnly=false) lists only client connections of the kind', () => {
    expect(ids(filterPickerConnections(conns, 'websocketConnect', false, ''))).toEqual(['wsClient'])
    expect(ids(filterPickerConnections(conns, 'socketioConnect', false, ''))).toEqual(['sioClient'])
  })

  it('unfiltered (serverOnly=undefined, e.g. a send node) lists every connection of the kind', () => {
    expect(ids(filterPickerConnections(conns, 'websocketConnect', undefined, ''))).toEqual(['wsClient', 'wsServer'])
  })

  it('keeps a persisted OUT-OF-CATEGORY selection visible (retro-compat)', () => {
    // A legacy websocketClose (client, serverOnly=false) still pointing at a server
    // connection: the server row is appended so the selection stays displayed.
    const client = filterPickerConnections(conns, 'websocketConnect', false, 'wsServer')
    expect(ids(client)).toEqual(['wsClient', 'wsServer'])
    // And the reverse: a server-close whose selection is a client connection.
    const server = filterPickerConnections(conns, 'websocketConnect', true, 'wsClient')
    expect(ids(server)).toEqual(['wsServer', 'wsClient'])
  })

  it('does not duplicate an in-category selection', () => {
    const server = filterPickerConnections(conns, 'websocketConnect', true, 'wsServer')
    expect(ids(server)).toEqual(['wsServer'])
  })

  it('an unknown / deleted selection id adds no phantom row', () => {
    expect(ids(filterPickerConnections(conns, 'websocketConnect', true, 'gone'))).toEqual(['wsServer'])
  })
})
