import { describe, it, expect } from 'vitest'
import { asyncapiToApiDocumentation, type AsyncAPISpecData } from '../../../../src/main/services/import/transformers/asyncapiToApiDocumentation'

const spec: AsyncAPISpecData = {
  asyncapi: '2.6.0',
  info: {
    title: 'Chat API',
    version: '1.0.0',
    description: 'Real-time chat'
  },
  servers: {
    production: { url: 'wss://example.com', protocol: 'websocket' },
    mqtt: { url: 'mqtts://example.com:8883', protocol: 'mqtt' }
  },
  channels: {
    '/chat/messages': {
      description: 'Chat message stream',
      servers: ['production'],
      publish: {
        operationId: 'sendMessage',
        description: 'Send a chat message',
        message: { $ref: '#/components/messages/ChatMessage' }
      },
      subscribe: {
        operationId: 'receiveMessage',
        message: { name: 'chatIn', payload: { type: 'object', properties: { text: { type: 'string', description: 'The body' } } } }
      }
    },
    'sensor/temperature': {
      servers: ['mqtt'],
      publish: {
        operationId: 'publishTemperature',
        message: { payload: { $ref: '#/components/schemas/Temperature' } }
      }
    }
  },
  components: {
    messages: {
      ChatMessage: { payload: { $ref: '#/components/schemas/ChatPayload' } }
    },
    schemas: {
      ChatPayload: { description: 'payload', properties: { text: { type: 'string' }, sender: { type: 'string' } }, required: ['text'] },
      Temperature: { properties: { value: { type: 'number' } } }
    }
  }
}

describe('asyncapiToApiDocumentation', () => {
  it('maps info + server.host to the first server url', () => {
    const doc = asyncapiToApiDocumentation(spec)
    expect(doc.sourceType).toBe('asyncapi')
    expect(doc.api.title).toBe('Chat API')
    expect(doc.api.description).toBe('Real-time chat')
    expect(doc.server?.host).toBe('wss://example.com')
  })

  it('groups channels by protocol label (WebSocket / MQTT)', () => {
    const doc = asyncapiToApiDocumentation(spec)
    expect(doc.groups.WebSocket).toEqual({ name: 'WebSocket' })
    expect(doc.groups.MQTT).toEqual({ name: 'MQTT' })
  })

  it('emits a publish and subscribe operation per channel with event + direction', () => {
    const doc = asyncapiToApiDocumentation(spec)
    const send = doc.operations.find((op) => op.operationId === 'sendMessage')
    expect(send?.match).toEqual({ urlPattern: 'wss://example.com', event: '/chat/messages', direction: 'publish' })
    expect(send?.group).toBe('WebSocket')
    const receive = doc.operations.find((op) => op.operationId === 'receiveMessage')
    expect(receive?.match.direction).toBe('subscribe')
  })

  it('falls back to channel description when operation has no description', () => {
    const doc = asyncapiToApiDocumentation(spec)
    const send = doc.operations.find((op) => op.operationId === 'sendMessage')
    expect(send?.description).toBe('Send a chat message')
    // receive has no description or summary, falls back to channel description
    const receive = doc.operations.find((op) => op.operationId === 'receiveMessage')
    expect(receive?.description).toBe('Chat message stream')
  })

  it('extracts inline message payload properties as parameters', () => {
    const doc = asyncapiToApiDocumentation(spec)
    const receive = doc.operations.find((op) => op.operationId === 'receiveMessage')
    expect(receive?.parameters).toEqual([
      { name: 'text', location: 'body', type: 'string', required: false, description: 'The body' }
    ])
  })

  it('resolves $ref messages and records referenced models', () => {
    const doc = asyncapiToApiDocumentation(spec)
    const send = doc.operations.find((op) => op.operationId === 'sendMessage')
    expect(send?.referencedModels).toEqual(['ChatPayload'])
    const publishTemp = doc.operations.find((op) => op.operationId === 'publishTemperature')
    expect(publishTemp?.referencedModels).toEqual(['Temperature'])
    expect(publishTemp?.match.event).toBe('sensor/temperature')
    expect(publishTemp?.group).toBe('MQTT')
  })

  it('maps components.schemas into models with required flags', () => {
    const doc = asyncapiToApiDocumentation(spec)
    const payload = doc.models.ChatPayload
    expect(payload?.description).toBe('payload')
    const text = payload?.properties.find((p) => p.name === 'text')
    expect(text?.required).toBe(true)
    const sender = payload?.properties.find((p) => p.name === 'sender')
    expect(sender?.required).toBe(false)
  })

  it('echoes sourceUrl when provided', () => {
    const doc = asyncapiToApiDocumentation(spec, { sourceUrl: 'https://example.com/asyncapi.yaml' })
    expect(doc.sourceUrl).toBe('https://example.com/asyncapi.yaml')
  })
})
