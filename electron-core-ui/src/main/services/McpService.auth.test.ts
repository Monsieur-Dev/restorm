import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { request as httpRequest } from 'node:http'

vi.mock('electron', () => ({
  app: {
    on: vi.fn(),
    off: vi.fn()
  },
  BrowserWindow: {
    getAllWindows: () => []
  },
  dialog: {
    showSaveDialog: vi.fn(),
    showOpenDialog: vi.fn(),
    showMessageBox: vi.fn()
  }
}))

vi.mock('./LoggerService', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  }
}))

import { McpService } from './McpService'

const TOKEN = 'a'.repeat(32)

interface ProbeResult { status: number; body: string }

function probe(port: number, headers: Record<string, string>): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path: '/',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'Content-Length': Buffer.byteLength(body),
          ...headers
        }
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
        })
      }
    )
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

describe('McpService auth gate', () => {
  describe('with authToken set', () => {
    const service = new McpService({ authToken: TOKEN })
    let port: number

    beforeAll(async () => {
      await service.start(0)
      const bound = service.getPort()
      if (bound === null) throw new Error('McpService failed to bind')
      port = bound
    })

    afterAll(async () => {
      await service.stop()
    })

    it('returns 401 when Authorization header is missing', async () => {
      const r = await probe(port, {})
      expect(r.status).toBe(401)
      expect(r.body).toBe('Unauthorized')
    })

    it('returns 401 when token is wrong', async () => {
      const r = await probe(port, { Authorization: `Bearer ${'b'.repeat(32)}` })
      expect(r.status).toBe(401)
    })

    it('returns 401 when scheme is not Bearer', async () => {
      const r = await probe(port, { Authorization: `Basic ${TOKEN}` })
      expect(r.status).toBe(401)
    })

    it('returns 401 when bearer prefix is missing', async () => {
      const r = await probe(port, { Authorization: TOKEN })
      expect(r.status).toBe(401)
    })

    it('does not return 401 when token matches', async () => {
      const r = await probe(port, { Authorization: `Bearer ${TOKEN}` })
      expect(r.status).not.toBe(401)
    })

    it('accepts a case-insensitive bearer scheme', async () => {
      const r = await probe(port, { Authorization: `bearer ${TOKEN}` })
      expect(r.status).not.toBe(401)
    })
  })

  describe('without authToken', () => {
    const service = new McpService()
    let port: number

    beforeAll(async () => {
      await service.start(0)
      const bound = service.getPort()
      if (bound === null) throw new Error('McpService failed to bind')
      port = bound
    })

    afterAll(async () => {
      await service.stop()
    })

    it('lets unauthenticated requests through (auth disabled)', async () => {
      const r = await probe(port, {})
      expect(r.status).not.toBe(401)
    })
  })
})
