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
    TrpcRequestTabView: stub
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
})
