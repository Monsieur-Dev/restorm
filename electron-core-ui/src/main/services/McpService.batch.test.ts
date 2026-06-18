import { describe, it, expect, vi } from 'vitest'

// `pickWindow` falls back to `BrowserWindow.getAllWindows()`. The batch
// tool tolerates "no window available" — the implicit settle becomes a
// no-op — so we just return an empty list. Individual tests stub the
// fake `executeJavaScript` path through the tool registry itself
// (no `BrowserWindow` is ever asked to run JS in this suite).
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

import { McpService } from './McpService'

function parseEnvelope(result: unknown): {
  ranCount: number
  totalCount: number
  aborted: boolean
  abortedAt: number | null
  results: { index: number; name: string; ok: boolean; error?: string }[]
} {
  const r = result as { content: { type: string; text?: string }[] }
  const last = r.content[r.content.length - 1]
  if (last?.type !== 'text' || typeof last.text !== 'string') {
    throw new Error('no envelope text part in batch result')
  }
  return JSON.parse(last.text) as {
    ranCount: number
    totalCount: number
    aborted: boolean
    abortedAt: number | null
    results: { index: number; name: string; ok: boolean; error?: string }[]
  }
}

describe('McpService — batch tool', () => {
  it('runs steps sequentially and aggregates their content parts in order', async () => {
    const service = new McpService()
    const calls: string[] = []
    service.registerTool('alpha', { titleKey: 'mcpToolTitles.test', title: 'a' }, (args) => {
      calls.push(`alpha:${JSON.stringify(args)}`)
      return { content: [{ type: 'text', text: 'a-out' }] }
    })
    service.registerTool('beta', { titleKey: 'mcpToolTitles.test', title: 'b' }, (args) => {
      calls.push(`beta:${JSON.stringify(args)}`)
      return { content: [{ type: 'text', text: 'b-out' }] }
    })

    const out = await Promise.resolve(service.invokeTool('batch', {
      steps: [
        { name: 'alpha', args: { x: 1 } },
        { name: 'beta', args: { y: 2 } }
      ],
      skipImplicitSettle: true
    })) as { content: { type: string; text?: string }[] }

    expect(calls).toEqual(['alpha:{"x":1}', 'beta:{"y":2}'])
    // Aggregated content: alpha's text, then beta's text, then envelope.
    expect(out.content.slice(0, 2)).toEqual([
      { type: 'text', text: 'a-out' },
      { type: 'text', text: 'b-out' }
    ])

    const env = parseEnvelope(out)
    expect(env.ranCount).toBe(2)
    expect(env.totalCount).toBe(2)
    expect(env.aborted).toBe(false)
    expect(env.abortedAt).toBeNull()
    expect(env.results.map((r) => ({ name: r.name, ok: r.ok }))).toEqual([
      { name: 'alpha', ok: true },
      { name: 'beta', ok: true }
    ])
  })

  it('aborts at the first failing step and skips subsequent ones', async () => {
    const service = new McpService()
    const calls: string[] = []
    service.registerTool('ok1', { titleKey: 'mcpToolTitles.test', title: '1' }, () => {
      calls.push('ok1')
      return { content: [{ type: 'text', text: 'first' }] }
    })
    service.registerTool('boom', { titleKey: 'mcpToolTitles.test', title: 'b' }, () => {
      calls.push('boom')
      return { content: [{ type: 'text', text: 'kaboom' }], isError: true }
    })
    service.registerTool('skipped', { titleKey: 'mcpToolTitles.test', title: 's' }, () => {
      calls.push('skipped')
      return { content: [] }
    })

    const out = await Promise.resolve(service.invokeTool('batch', {
      steps: [{ name: 'ok1' }, { name: 'boom' }, { name: 'skipped' }],
      skipImplicitSettle: true
    })) as { content: unknown[]; isError?: boolean }

    expect(calls).toEqual(['ok1', 'boom'])
    expect(out.isError).toBe(true)
    const env = parseEnvelope(out)
    expect(env.ranCount).toBe(1)
    expect(env.totalCount).toBe(3)
    expect(env.aborted).toBe(true)
    expect(env.abortedAt).toBe(1)
    expect(env.results[1]?.ok).toBe(false)
    expect(env.results[1]?.error).toBe('kaboom')
    expect(env.results.length).toBe(2)
  })

  it('aborts when a step handler throws', async () => {
    const service = new McpService()
    service.registerTool('throws', { titleKey: 'mcpToolTitles.test', title: 't' }, () => { throw new Error('nope') })
    service.registerTool('after', { titleKey: 'mcpToolTitles.test', title: 'a' }, () => ({ content: [] }))

    const out = await Promise.resolve(service.invokeTool('batch', {
      steps: [{ name: 'throws' }, { name: 'after' }],
      skipImplicitSettle: true
    })) as { content: unknown[]; isError?: boolean }

    expect(out.isError).toBe(true)
    const env = parseEnvelope(out)
    expect(env.aborted).toBe(true)
    expect(env.abortedAt).toBe(0)
    expect(env.results[0]?.error).toBe('nope')
  })

  it('rejects an empty steps array', async () => {
    const service = new McpService()
    const out = await Promise.resolve(service.invokeTool('batch', { steps: [] })) as
      { content: { type: string; text: string }[]; isError?: boolean }
    expect(out.isError).toBe(true)
    expect(out.content[0]?.text).toMatch(/non-empty/i)
  })

  it('rejects a step missing a non-empty name', async () => {
    const service = new McpService()
    service.registerTool('present', { titleKey: 'mcpToolTitles.test', title: 'p' }, () => ({ content: [] }))
    const out = await Promise.resolve(service.invokeTool('batch', {
      steps: [{ name: '' }],
      skipImplicitSettle: true
    })) as { content: unknown[]; isError?: boolean }
    expect(out.isError).toBe(true)
    const env = parseEnvelope(out)
    expect(env.aborted).toBe(true)
    expect(env.results[0]?.error).toMatch(/non-empty string/)
  })

  it('honours `waitFor: { ms }` between steps', async () => {
    const service = new McpService()
    const ts: number[] = []
    service.registerTool('mark', { titleKey: 'mcpToolTitles.test', title: 'm' }, () => {
      ts.push(Date.now())
      return { content: [{ type: 'text', text: String(ts.length) }] }
    })

    const out = await Promise.resolve(service.invokeTool('batch', {
      steps: [
        { name: 'mark', waitFor: { ms: 80 } },
        { name: 'mark' }
      ],
      skipImplicitSettle: true
    })) as { content: unknown[]; isError?: boolean }

    expect(out.isError).toBeFalsy()
    expect(ts.length).toBe(2)
    const first = ts[0] ?? 0
    const second = ts[1] ?? 0
    expect(second - first).toBeGreaterThanOrEqual(60) // tolerate timer jitter
  })

  it('invokeTool throws for unknown tool names', () => {
    const service = new McpService()
    expect(() => service.invokeTool('ghost', {})).toThrow(/not registered/)
  })

  it('inlines screencast-stop video as a resource part', async () => {
    const { writeFileSync, mkdirSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = join(tmpdir(), `mcp-batch-test-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    const videoPath = join(dir, 'clip.webm')
    const bytes = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81])
    writeFileSync(videoPath, bytes)

    const service = new McpService()
    // The built-in `screencast-stop` needs a live BrowserWindow; the
    // electron mock can't provide one. Replace its handler in the
    // registry with a stub that returns the same text-part shape the
    // real handler does (path + mimeType in JSON) so the batch tool's
    // inlining logic exercises against realistic input.
    const tools = (service as unknown as { tools: { name: string; handler: (a: Record<string, unknown>) => unknown }[] }).tools
    const entry = tools.find((t) => t.name === 'screencast-stop')
    if (!entry) throw new Error('screencast-stop tool not found')
    entry.handler = () => ({
      content: [{ type: 'text', text: JSON.stringify({ path: videoPath, byteLength: bytes.length, durationMs: 100, mimeType: 'video/webm' }) }]
    })

    const out = await Promise.resolve(service.invokeTool('batch', {
      steps: [{ name: 'screencast-stop' }],
      skipImplicitSettle: true
    })) as { content: { type: string; resource?: { blob?: string; mimeType?: string; uri?: string } }[] }

    const resource = out.content.find((c) => c.type === 'resource')
    expect(resource).toBeDefined()
    expect(resource?.resource?.mimeType).toBe('video/webm')
    expect(resource?.resource?.uri).toContain(videoPath)
    const decoded = Buffer.from(resource?.resource?.blob ?? '', 'base64')
    expect(Buffer.compare(decoded, bytes)).toBe(0)
  })
})
