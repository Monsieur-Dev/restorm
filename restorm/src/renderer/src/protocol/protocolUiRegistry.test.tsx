import { describe, it, expect, vi } from 'vitest'
import { REQUEST_TYPES } from '../../../shared/protocolRegistry'

// The real tab views pull in Monaco / heavy editors at import time; stub the
// barrel so this drift guard stays a pure registry check.
vi.mock('../components/RequestTabViews', () => {
  const stub = (): null => null
  return {
    HTTPRequestTabView: stub,
    GraphQLRequestTabView: stub,
    GrpcRequestTabView: stub,
    SoapRequestTabView: stub,
    SoapServerRequestTabView: stub,
    WebSocketRequestTabView: stub,
    SseRequestTabView: stub,
    ODataRequestTabView: stub,
    JsonRpcRequestTabView: stub,
    JsonRpcBatchRequestTabView: stub,
    TrpcRequestTabView: stub,
    AmqpRequestTabView: stub,
    RedisRequestTabView: stub,
    StompRequestTabView: stub,
    KafkaRequestTabView: stub
  }
})

describe('renderer protocol UI registry', () => {
  it('has a tab view for every protocol (no drift from the shared registry)', async () => {
    const { PROTOCOL_TAB_VIEWS } = await import('./protocolUiRegistry')
    expect(Object.keys(PROTOCOL_TAB_VIEWS).sort()).toEqual([...REQUEST_TYPES].sort())
  })

  it('resolves a tab-view element for every protocol type', async () => {
    const { renderProtocolTabView } = await import('./protocolUiRegistry')
    for (const type of REQUEST_TYPES) {
      // Only the `type` discriminant is needed to pick the tab view; the SOAP
      // client/server split reads `server`, absent here → client editor.
      const element = renderProtocolTabView({ type } as never)
      expect(element).toBeTruthy()
    }
  })

  it('folds the reload epoch into the element key so a bump forces a remount', async () => {
    const { renderProtocolTabView } = await import('./protocolUiRegistry')
    const request = { type: 'http', id: 'req-1' } as never
    // Same request + same epoch → stable key (ordinary re-renders never remount).
    expect((renderProtocolTabView(request, 0) as { key: string }).key)
      .toBe((renderProtocolTabView(request, 0) as { key: string }).key)
    // A bump changes the key → React remounts the view, re-reading the request.
    expect((renderProtocolTabView(request, 0) as { key: string }).key)
      .not.toBe((renderProtocolTabView(request, 1) as { key: string }).key)
    // Distinct requests keep distinct keys at the same epoch.
    expect((renderProtocolTabView(request, 1) as { key: string }).key)
      .not.toBe((renderProtocolTabView({ type: 'http', id: 'req-2' } as never, 1) as { key: string }).key)
  })
})
