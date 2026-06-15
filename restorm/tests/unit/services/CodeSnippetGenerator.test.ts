import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import Handlebars from 'handlebars'
import { registerHandlebarsHelpers } from '../../../src/shared/utils/handlebars/registerAll'

// The templates use shared helpers (e.g. `lowercase`) registered globally at
// app startup; register them on the global Handlebars before compiling.
registerHandlebarsHelpers()

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('electron-core-ui/main', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

const { generateCodeSnippets } = await import('../../../src/main/services/CodeSnippetGenerator')
import type { CompiledSnippetTemplates } from '../../../src/main/services/CodeSnippetGenerator'
import type { FullRequestData } from '../../../src/renderer/src/types/global.d'

// Compile the real templates from source (the production loader resolves a
// packaged/dist path that doesn't exist under vitest), then pass them in.
function compile(name: string): Handlebars.TemplateDelegate {
  const src = readFileSync(join(process.cwd(), 'src/main/resources/templates', name), 'utf-8')
  return Handlebars.compile(src, { noEscape: true })
}
const templates: CompiledSnippetTemplates = {
  httpSnippetTemplate: null,
  graphqlSnippetTemplate: null,
  soapSnippetTemplate: null,
  websocketSnippetTemplate: compile('code-snippets-websocket.hbs'),
  grpcSnippetTemplate: compile('code-snippets-grpc.hbs')
} as unknown as CompiledSnippetTemplates

// Identity transform (no env vars needed for these structural assertions).
const identity = (v: string): string => v
const envContext = {} as never

function run(data: Partial<FullRequestData>, resolvedUrl: string): string {
  return generateCodeSnippets(
    data as FullRequestData,
    envContext,
    { resolvedUrl } as never,
    templates,
    identity
  ).markdown
}

describe('CodeSnippetGenerator — gRPC', () => {
  const base: Partial<FullRequestData> = {
    requestType: 'grpc', url: 'localhost:9000', headers: [], service: 'grpcbin.GRPCBin',
    grpcMethod: 'DummyUnary', callType: 'unary', requestMessage: '{"f_string":"hi"}', metadata: []
  }

  it('adds -plaintext for an insecure (no-scheme) server', () => {
    const md = run(base, 'localhost:9000')
    expect(md).toContain('-plaintext')
    expect(md).toContain('grpcbin.GRPCBin/DummyUnary')
  })

  it('omits -plaintext for a grpcs:// (TLS) server', () => {
    const md = run({ ...base, url: 'grpcs://secure:443' }, 'grpcs://secure:443')
    expect(md).not.toContain('-plaintext')
  })

  it('renders metadata as grpcurl -H headers', () => {
    const md = run({ ...base, metadata: [{ key: 'x-token', value: 'abc', enabled: true } as never] }, 'localhost:9000')
    expect(md).toContain("-H 'x-token: abc'")
  })
})

describe('CodeSnippetGenerator — WebSocket / Socket.IO', () => {
  it('renders the native-WebSocket snippet (not empty) for a raw websocket request', () => {
    const md = run({ requestType: 'websocket', url: 'ws://localhost:3002', headers: [], protocol: 'websocket', message: '{"hello":"world"}' }, 'ws://localhost:3002')
    expect(md.trim().length).toBeGreaterThan(0)
    expect(md).toContain('new WebSocket')
    expect(md).toContain('ws://localhost:3002')
  })

  it('renders the Socket.IO snippet for a socketio request', () => {
    const md = run({ requestType: 'websocket', url: 'http://localhost:3001', headers: [], protocol: 'socketio', event: 'chat', message: '{"hi":1}' }, 'http://localhost:3001')
    expect(md.trim().length).toBeGreaterThan(0)
    expect(md).toContain('socket.io-client')
    expect(md).toContain('chat')
  })
})
