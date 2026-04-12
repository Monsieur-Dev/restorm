import { describe, it, expect } from 'vitest'
import { wsdlToApiDocumentation, type ParsedWsdlData } from '../../../../src/main/services/import/transformers/wsdlToApiDocumentation'

const parsed: ParsedWsdlData = {
  targetNamespace: 'http://example.com/orders',
  services: [
    {
      name: 'OrderService',
      documentation: 'Handles order lifecycle',
      ports: [
        { name: 'OrderPort', binding: 'tns:OrderBinding', address: 'https://example.com/orders' }
      ]
    }
  ],
  portTypes: [
    {
      name: 'OrderPortType',
      operations: [
        { name: 'CreateOrder', documentation: 'Creates a new order', soapAction: 'urn:CreateOrder' },
        { name: 'GetOrder', soapAction: 'urn:GetOrder' }
      ]
    }
  ],
  bindings: [
    {
      name: 'OrderBinding',
      portType: 'tns:OrderPortType',
      operations: [
        { name: 'CreateOrder', soapAction: 'urn:CreateOrder' },
        { name: 'GetOrder', soapAction: 'urn:GetOrder' }
      ]
    }
  ]
}

describe('wsdlToApiDocumentation', () => {
  it('uses the first service name as title and fills server info', () => {
    const doc = wsdlToApiDocumentation(parsed)
    expect(doc.sourceType).toBe('wsdl')
    expect(doc.api.title).toBe('OrderService')
    expect(doc.api.description).toBe('SOAP Web Service')
    expect(doc.server).toEqual({
      namespace: 'http://example.com/orders',
      host: 'https://example.com/orders'
    })
  })

  it('creates one group per service with its documentation', () => {
    const doc = wsdlToApiDocumentation(parsed)
    expect(doc.groups.OrderService).toEqual({
      name: 'OrderService',
      description: 'Handles order lifecycle'
    })
  })

  it('creates one operation per binding operation with soapAction + operationName + serviceName match', () => {
    const doc = wsdlToApiDocumentation(parsed)
    expect(doc.operations).toHaveLength(2)
    const create = doc.operations.find((o) => o.operationId === 'CreateOrder')
    expect(create?.match).toEqual({
      urlPattern: 'https://example.com/orders',
      soapAction: 'urn:CreateOrder',
      operationName: 'CreateOrder',
      serviceName: 'OrderService'
    })
    expect(create?.group).toBe('OrderService')
    expect(create?.summary).toBe('CreateOrder')
  })

  it('pulls operation documentation from the portType when missing on the binding', () => {
    const doc = wsdlToApiDocumentation(parsed)
    const create = doc.operations.find((o) => o.operationId === 'CreateOrder')
    expect(create?.description).toBe('Creates a new order')
  })

  it('omits description when neither binding nor portType provide one', () => {
    const doc = wsdlToApiDocumentation(parsed)
    const get = doc.operations.find((o) => o.operationId === 'GetOrder')
    expect(get?.description).toBeUndefined()
  })

  it('falls back to options.name when no service is present', () => {
    const empty: ParsedWsdlData = { targetNamespace: '', services: [], portTypes: [], bindings: [] }
    const doc = wsdlToApiDocumentation(empty, { name: 'Legacy', baseUrl: 'http://legacy/soap' })
    expect(doc.api.title).toBe('Legacy')
    expect(doc.operations).toEqual([])
  })

  it('echoes sourceUrl when provided', () => {
    const doc = wsdlToApiDocumentation(parsed, { sourceUrl: 'https://example.com/orders.wsdl' })
    expect(doc.sourceUrl).toBe('https://example.com/orders.wsdl')
  })
})
