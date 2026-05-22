import { describe, it, expect, vi, beforeEach } from 'vitest'

// Controllable electron mock: one fake window whose `webContents.sendInputEvent`
// records the trusted events the tool emits, and whose `executeJavaScript`
// stands in for selector → rect-centre resolution.
const mockState = vi.hoisted(() => {
  const inputEvents: Record<string, unknown>[] = []
  return {
    inputEvents,
    fakeWindow: {
      isDestroyed: () => false,
      webContents: {
        id: 1,
        sendInputEvent: (e: Record<string, unknown>) => { inputEvents.push(e) },
        executeJavaScript: vi.fn(() => Promise.resolve({ x: 100, y: 200 })),
        send: vi.fn()
      }
    },
    reset(): void { inputEvents.length = 0 }
  }
})

vi.mock('electron', () => ({
  app: { on: vi.fn(), off: vi.fn() },
  BrowserWindow: {
    getAllWindows: () => [mockState.fakeWindow],
    getFocusedWindow: () => mockState.fakeWindow
  },
  ipcMain: { on: vi.fn(), off: vi.fn() },
  dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn(), showMessageBox: vi.fn() }
}))

vi.mock('./LoggerService', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

import { McpService } from './McpService'

const types = (): unknown[] => mockState.inputEvents.map((e) => e['type'])

describe('McpService — mouse-input (trusted sendInputEvent)', () => {
  beforeEach(() => { mockState.reset() })

  it('move: a single trusted mouseMove at explicit coords', async () => {
    const service = new McpService()
    await service.invokeTool('mouse-input', { gesture: 'move', x: 50, y: 60 })
    expect(mockState.inputEvents).toEqual([{ type: 'mouseMove', x: 50, y: 60 }])
  })

  it('click: move → down → up at coords with the given button', async () => {
    const service = new McpService()
    await service.invokeTool('mouse-input', { gesture: 'click', x: 10, y: 20, button: 'left' })
    expect(types()).toEqual(['mouseMove', 'mouseDown', 'mouseUp'])
    expect(mockState.inputEvents[1]).toMatchObject({ type: 'mouseDown', x: 10, y: 20, button: 'left', clickCount: 1 })
  })

  it('drag: down at start, frame-paced moves across the path, up at the target', async () => {
    const service = new McpService()
    await service.invokeTool('mouse-input', { gesture: 'drag', x: 0, y: 0, toX: 30, toY: 0, steps: 3 })
    const t = types()
    expect(t[0]).toBe('mouseMove') // settle at start
    expect(t[1]).toBe('mouseDown')
    expect(t.filter((x) => x === 'mouseMove').length).toBe(1 + 3) // start + steps moves
    expect(t[t.length - 1]).toBe('mouseUp')
    expect(mockState.inputEvents[mockState.inputEvents.length - 1]).toMatchObject({ type: 'mouseUp', x: 30, y: 0 })
    // The in-drag moves must signal the held button so Chromium reports
    // `buttons: 1` (otherwise React Flow's connection drag never starts).
    const inDragMoves = mockState.inputEvents.slice(2, -1).filter((e) => e['type'] === 'mouseMove')
    expect(inDragMoves.length).toBe(3)
    expect(inDragMoves.every((e) => Array.isArray(e['modifiers']) && (e['modifiers'] as string[]).includes('leftButtonDown'))).toBe(true)
  })

  it('wheel: a trusted mouseWheel carrying the delta at coords', async () => {
    const service = new McpService()
    await service.invokeTool('mouse-input', { gesture: 'wheel', x: 5, y: 5, deltaY: -120 })
    expect(types()).toEqual(['mouseMove', 'mouseWheel'])
    expect(mockState.inputEvents[1]).toMatchObject({ type: 'mouseWheel', deltaY: -120 })
  })

  it('resolves coords from a selector rect centre when x/y are omitted', async () => {
    const service = new McpService()
    await service.invokeTool('mouse-input', { gesture: 'move', selector: '.target' })
    expect(mockState.fakeWindow.webContents.executeJavaScript).toHaveBeenCalled()
    expect(mockState.inputEvents).toEqual([{ type: 'mouseMove', x: 100, y: 200 }])
  })
})
