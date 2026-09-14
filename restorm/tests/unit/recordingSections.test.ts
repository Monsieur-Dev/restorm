import { describe, it, expect } from 'vitest'
import { RECORDING_NODES, recordingNodeRowId, parseRecordingNodeRowId, recordingTabId, parseRecordingTabId, recordingNodeSpec } from '../../src/shared/recording/recordingSections'

describe('recording sections — sidebar row ids and tab ids', () => {
  const sessionId = '3fa85f64-5717-4562-b3fc-2c963f66afa6'

  it('lists the three virtual nodes in display order: browser, captures, routes', () => {
    expect(RECORDING_NODES.map((n) => n.key)).toEqual(['browser', 'captures', 'routes'])
    expect(recordingNodeSpec('routes').labelKey).toBe('recording.node.routes')
  })

  it('round-trips a node row id', () => {
    const rowId = recordingNodeRowId(sessionId, 'captures')
    expect(rowId).toBe(`recording-node:${sessionId}:captures`)
    expect(parseRecordingNodeRowId(rowId)).toEqual({ sessionId, kind: 'captures' })
  })

  it('rejects ids that are not node rows', () => {
    expect(parseRecordingNodeRowId(sessionId)).toBeNull()
    expect(parseRecordingNodeRowId('design-section:x:routes')).toBeNull()
    expect(parseRecordingNodeRowId(`recording-node:${sessionId}:settings`)).toBeNull()
    expect(parseRecordingNodeRowId('recording-node::captures')).toBeNull()
  })

  it('keys the config tab like every item tab and the node tabs with their node', () => {
    expect(recordingTabId(sessionId, 'config')).toBe(`recording-id:${sessionId}`)
    expect(recordingTabId(sessionId, 'browser')).toBe(`recording-node-id:${sessionId}:browser`)
    expect(parseRecordingTabId(`recording-id:${sessionId}`)).toEqual({ sessionId, node: 'config' })
    expect(parseRecordingTabId(`recording-node-id:${sessionId}:routes`)).toEqual({ sessionId, node: 'routes' })
    expect(parseRecordingTabId(`design-id:${sessionId}`)).toBeNull()
    expect(parseRecordingTabId('recording-id:')).toBeNull()
    expect(parseRecordingTabId(`recording-node-id:${sessionId}:nope`)).toBeNull()
  })
})
