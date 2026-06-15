import { describe, it, expect } from 'vitest'
import { collectProjectOrigins } from './collectProjectOrigins'
import type { FolderItem } from '../types/collections'

/**
 * The firewall's project-origin allowlist must see requests authored INSIDE a
 * scenario (scenarios are folder-like containers via `scenario.items`), not just
 * requests under env-folders / folders — else a scenario-nested request isn't
 * recognised as a known destination and the firewall prompts for it.
 */

const httpReq = (id: string, url: string): FolderItem =>
  ({ id, type: 'http', name: id, url, method: 'GET', headers: [] } as unknown as FolderItem)

const wsReq = (id: string, url: string): FolderItem =>
  ({ id, type: 'websocket', name: id, url, protocol: 'socketio', headers: [] } as unknown as FolderItem)

const scenario = (id: string, items: FolderItem[]): FolderItem =>
  ({ id, type: 'scenario', name: id, tags: [], params: [], nodes: [], edges: [], items } as unknown as FolderItem)

const folder = (id: string, items: FolderItem[]): FolderItem =>
  ({ id, name: id, items, configuration: {} } as unknown as FolderItem)

const envFolder = (id: string, vars: Record<string, string>, items: FolderItem[]): FolderItem =>
  ({
    id,
    name: id,
    folderType: 'environment',
    configuration: {},
    environments: [{ id: `${id}-env`, name: 'Default', variables: Object.entries(vars).map(([key, value]) => ({ key, value: { type: 'string', value } })) }],
    items
  } as unknown as FolderItem)

const origins = (items: FolderItem[]): string[] =>
  collectProjectOrigins(items).map((o) => `${o.scheme}://${o.host}:${String(o.port)}`).sort()

describe('collectProjectOrigins — scenario-nested requests', () => {
  it('collects a request authored inside a scenario container', () => {
    const tree = [
      envFolder('env', { socketUrl: 'http://localhost:3001' }, [
        folder('f', [
          httpReq('plain', 'http://localhost:5110/pets'),
          scenario('scn', [wsReq('echo', '{{socketUrl}}')])
        ])
      ])
    ]
    const got = origins(tree)
    // Baseline (folder request) still collected …
    expect(got).toContain('http://localhost:5110')
    // … and the scenario-nested request's origin too (the regression).
    expect(got).toContain('http://localhost:3001')
  })

  it('recurses into sub-scenarios nested inside a scenario', () => {
    const tree = [
      folder('f', [
        scenario('outer', [
          httpReq('a', 'http://api.one:8080/x'),
          scenario('inner', [httpReq('b', 'http://api.two:9090/y')])
        ])
      ])
    ]
    const got = origins(tree)
    expect(got).toContain('http://api.one:8080')
    expect(got).toContain('http://api.two:9090')
  })

  it('a scenario with no items contributes nothing (no crash)', () => {
    const tree = [folder('f', [scenario('empty', [])])]
    expect(origins(tree)).toEqual([])
  })
})
