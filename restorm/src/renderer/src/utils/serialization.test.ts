import { describe, it, expect } from 'vitest'
import { generateIds, processAfterDeserialization } from './serialization'
import { parseProjectYaml } from '../../../shared/git/gitCommitDiff'

interface ReqItem { id?: string; type: string; name: string }
interface FolderItem { name: string; configuration: Record<string, unknown>; items: ReqItem[] }
interface Tree { collections: FolderItem[] }

function idsOf(tree: Tree): ReqItem[] {
  const out = generateIds(tree)
  const folder = out.collections[0]
  if (!folder) throw new Error('expected a folder')
  return folder.items
}

describe('generateIds — request-type id assignment', () => {
  it('assigns ids to every request kind incl. odata and auth', () => {
    const items = idsOf({
      collections: [
        { name: 'F', configuration: {}, items: [
          { name: 'h', type: 'http' },
          { name: 'g', type: 'graphql' },
          { name: 'r', type: 'grpc' },
          { name: 's', type: 'soap' },
          { name: 'w', type: 'websocket' },
          { name: 'o', type: 'odata' },
          { name: 'a', type: 'auth' }
        ] }
      ]
    })
    for (const item of items) {
      expect(typeof item.id, `${item.type} should have an id`).toBe('string')
      expect((item.id ?? '').length).toBeGreaterThan(0)
    }
    // The regression: odata + auth previously fell through and got no id.
    expect(items.find((i) => i.type === 'odata')?.id).toBeTruthy()
    expect(items.find((i) => i.type === 'auth')?.id).toBeTruthy()
  })

  it('regenerates a duplicate id on copy-paste of an odata/auth request', () => {
    const items = idsOf({
      collections: [
        { name: 'F', configuration: {}, items: [
          { name: 'o1', type: 'odata', id: 'dup-id' },
          { name: 'o2', type: 'odata', id: 'dup-id' },
          { name: 'a1', type: 'auth', id: 'dup-auth' },
          { name: 'a2', type: 'auth', id: 'dup-auth' }
        ] }
      ]
    })
    const ids = items.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('parseProjectYaml wired to processAfterDeserialization', () => {
  it('backfills a missing id when the renderer passes processAfterDeserialization as the rehydrate callback', () => {
    // `parseProjectYaml` (shared/git/gitCommitDiff.ts) itself does no
    // rehydration by default (main-process / MCP callers only need
    // JSON-safe data) — this is the renderer-side wiring check that
    // `usePushModal.ts` / `useGitPullConflict.ts` rely on: passing
    // `processAfterDeserialization` explicitly restores id-backfill.
    const yaml = [
      'collections:',
      '  - name: Find pet by ID',
      '    type: http',
      '    tags: []'
    ].join('\n')
    const items = parseProjectYaml(yaml, processAfterDeserialization)
    expect(items).toHaveLength(1)
    expect(typeof items[0]?.id).toBe('string')
    expect((items[0]?.id ?? '').length).toBeGreaterThan(0)
  })
})

describe('quick-config timestamps are dropped on load', () => {
  it('removes createdAt/updatedAt from a saved quick-config, including corrupted ones', () => {
    // The two fields were written since quick-configs existed but read by
    // nothing, and files in the wild carry `{}` where a Date was destroyed
    // by the serializer. Dropping them on load lets the next save heal the
    // file, with no separate migration.
    const loaded = processAfterDeserialization({
      collections: [{
        id: 'r1',
        name: 'Fiche',
        quickConfigs: [{
          id: 'qc1', name: 'Recette', requestId: 'r1', storageTarget: 'project',
          fields: { url: 'https://example.com' }, createdAt: {}, updatedAt: '2026-07-22T05:07:12.471Z'
        }]
      }]
    })
    const config = (loaded.collections[0] as { quickConfigs: Record<string, unknown>[] }).quickConfigs[0]

    expect(config).toBeDefined()
    expect('createdAt' in (config ?? {})).toBe(false)
    expect('updatedAt' in (config ?? {})).toBe(false)
    expect(config?.['fields']).toEqual({ url: 'https://example.com' })
  })

  it('leaves createdAt alone outside a quick-config', () => {
    // Only a quick-config's own timestamps are this function's business.
    const loaded = processAfterDeserialization({ report: { createdAt: '2026-07-22T05:00:00.000Z' } })
    expect(loaded.report.createdAt).toBe('2026-07-22T05:00:00.000Z')
  })
})

describe("a scenario node's config bag", () => {
  it('never receives a generated id, even when it carries a requestId', () => {
    // An httpRequest node's config holds `requestId`, which the
    // "looks like a response" heuristic matches. Minting an id there made
    // every open produce a different value, which the next save persisted
    // — so a node nobody edited showed up as conflicting between two
    // people working on the same project.
    const loaded = processAfterDeserialization({
      nodes: [{ id: 'n1', kind: 'httpRequest', config: { label: 'Consulter', requestId: 'r1' } }]
    })
    const config = loaded.nodes[0]?.config as Record<string, unknown>

    expect('id' in config).toBe(false)
    expect(config).toEqual({ label: 'Consulter', requestId: 'r1' })
  })

  it('drops an id a previous version already persisted into the bag', () => {
    const loaded = processAfterDeserialization({
      nodes: [{ id: 'n1', kind: 'log', config: { id: 'da9340fc-stale', label: 'Trace' } }]
    })

    expect(loaded.nodes[0]?.config).toEqual({ label: 'Trace' })
  })
})
