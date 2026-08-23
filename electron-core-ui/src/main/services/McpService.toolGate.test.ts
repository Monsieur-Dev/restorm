import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { on: vi.fn(), off: vi.fn() },
  BrowserWindow: {
    getAllWindows: () => [],
    getFocusedWindow: () => null
  },
  dialog: {
    showSaveDialog: vi.fn(),
    showOpenDialog: vi.fn(),
    showMessageBox: vi.fn()
  }
}))

vi.mock('./LoggerService', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

import { McpService, type McpToolGate, type McpToolResult } from './McpService'

/**
 * A minimal gate that treats one named tool as gated and refuses it unless the
 * (mutable) `pro` flag is set — mirrors the real host gate's shape without
 * pulling in the host app's entitlement machinery.
 */
function makeGate(gatedName: string, state: { pro: boolean }): McpToolGate {
  return {
    gatedDescriptionSuffix: ' (Pro)',
    isGated: (name) => name === gatedName,
    authorize: (name): McpToolResult | null => {
      if (name !== gatedName) return null
      if (state.pro) return null
      return {
        content: [{ type: 'text', text: 'needs pro' }],
        isError: true,
        structuredContent: { code: 'payment_required', httpEquivalent: 402 }
      }
    }
  }
}

describe('McpService — per-tool gate', () => {
  it('refuses a gated tool via invokeTool without the capability (handler never runs)', () => {
    const service = new McpService()
    const state = { pro: false }
    let ran = false
    service.registerTool('adv', { titleKey: 'mcpToolTitles.test', title: 'adv' }, () => {
      ran = true
      return { content: [{ type: 'text', text: 'ok' }] }
    })
    service.setToolGate(makeGate('adv', state))

    const out = service.invokeTool('adv', {}) as McpToolResult
    expect(ran).toBe(false)
    expect(out.isError).toBe(true)
    expect(out.structuredContent?.['httpEquivalent']).toBe(402)
  })

  it('lets the gated tool run once the capability is present', () => {
    const service = new McpService()
    const state = { pro: true }
    let ran = false
    service.registerTool('adv', { titleKey: 'mcpToolTitles.test', title: 'adv' }, () => {
      ran = true
      return { content: [{ type: 'text', text: 'ok' }] }
    })
    service.setToolGate(makeGate('adv', state))

    const out = service.invokeTool('adv', {}) as { content: { text?: string }[] }
    expect(ran).toBe(true)
    expect(out.content[0]?.text).toBe('ok')
  })

  it('never gates a free tool', () => {
    const service = new McpService()
    const state = { pro: false }
    service.registerTool('free', { titleKey: 'mcpToolTitles.test', title: 'free' }, () => ({
      content: [{ type: 'text', text: 'free-out' }]
    }))
    service.setToolGate(makeGate('adv', state))

    const out = service.invokeTool('free', {}) as { content: { text?: string }[] }
    expect(out.content[0]?.text).toBe('free-out')
  })

  it('a free batch cannot smuggle a gated sub-call past the gate', async () => {
    const service = new McpService()
    const state = { pro: false }
    let advRan = false
    service.registerTool('adv', { titleKey: 'mcpToolTitles.test', title: 'adv' }, () => {
      advRan = true
      return { content: [{ type: 'text', text: 'adv-out' }] }
    })
    service.setToolGate(makeGate('adv', state))

    const out = (await Promise.resolve(service.invokeTool('batch', {
      steps: [{ name: 'adv', args: {} }],
      skipImplicitSettle: true
    }))) as { content: { type: string; text?: string }[] }

    expect(advRan).toBe(false)
    // The batch envelope (last text part) records the sub-call as failed.
    const envelope = JSON.parse(out.content[out.content.length - 1]?.text ?? '{}') as {
      results: { name: string; ok: boolean }[]
    }
    const adv = envelope.results.find((r) => r.name === 'adv')
    expect(adv?.ok).toBe(false)
  })

  it('no gate installed = every tool runs (zero behaviour change)', () => {
    const service = new McpService()
    let ran = false
    service.registerTool('adv', { titleKey: 'mcpToolTitles.test', title: 'adv' }, () => {
      ran = true
      return { content: [{ type: 'text', text: 'ok' }] }
    })
    const out = service.invokeTool('adv', {}) as { content: { text?: string }[] }
    expect(ran).toBe(true)
    expect(out.content[0]?.text).toBe('ok')
  })
})
