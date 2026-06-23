import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { FullRequestData } from '../../services/ContextServiceTypes'

// flushRequestStateToContext bridges a sidebar request's model into the
// ContextService so the scenario engine (soapListen) can read it. This guards
// the cross-process trap: a hosted SOAP mock's `server` + `mockOperations` must
// reach `fullData` (the request-panel path pushes them explicitly, but the
// scenario path goes through this helper — and used to drop them, so every
// served request answered an "unmatched" fault).

const updateFullRequestData = vi.fn<(id: string, data: FullRequestData) => void>()

vi.mock('../../services/ContextService', () => ({
  contextService: {
    getRequestContext: (_id: string) => ({}), // already registered → skip inline register
    updateFullRequestData: (id: string, data: FullRequestData) => { updateFullRequestData(id, data) }
  }
}))

vi.mock('../../services/CollectionStore', () => ({
  collectionStore: { findParentFolder: (_id: string) => null }
}))

import { flushRequestStateToContext } from './execute'
import { SoapRequest } from '../../../shared/models/requests/SoapRequest'

beforeEach(() => { updateFullRequestData.mockReset() })

describe('flushRequestStateToContext — SOAP server mode', () => {
  it('carries server + mockOperations into fullData so soapListen can serve them', () => {
    const soap = new SoapRequest({
      id: 'soap-mock-1',
      name: 'Calculator Mock',
      url: 'localhost:8076/calculator',
      server: true,
      mockOperations: [
        { name: 'Add', soapAction: 'urn:Add', responseBody: '<AddResponse><result>7</result></AddResponse>' },
        { name: 'Boom', responseBody: 'broke', isFault: true }
      ]
    })

    flushRequestStateToContext(soap as unknown as Parameters<typeof flushRequestStateToContext>[0])

    expect(updateFullRequestData).toHaveBeenCalledTimes(1)
    const data: FullRequestData = updateFullRequestData.mock.calls[0][1]
    expect(data.requestType).toBe('soap')
    expect(data.server).toBe(true)
    expect(data.soapMockOperations).toEqual([
      { name: 'Add', soapAction: 'urn:Add', responseBody: '<AddResponse><result>7</result></AddResponse>' },
      { name: 'Boom', responseBody: 'broke', isFault: true }
    ])
  })

  it('omits server + mockOperations for a plain client SOAP request', () => {
    const soap = new SoapRequest({ id: 'soap-client-1', name: 'Client', url: 'https://example.com/svc', soapAction: 'urn:Op' })
    flushRequestStateToContext(soap as unknown as Parameters<typeof flushRequestStateToContext>[0])
    const data: FullRequestData = updateFullRequestData.mock.calls[0][1]
    expect(data.server).toBeUndefined()
    expect(data.soapMockOperations).toBeUndefined()
  })
})
