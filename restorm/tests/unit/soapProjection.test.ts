/**
 * SOAP projection — WSDL emission, dispatch and payloads, with the
 * round-trip guarantee: the emitted WSDL must import back through the
 * app's own SOAP importer (one request per operation, soapAction kept).
 */

import { describe, it, expect } from 'vitest'
import {
  buildSoapFaultEnvelope,
  buildSoapResponseEnvelope,
  designSoapNamespace,
  designSoapOperations,
  designSoapServiceName,
  designToWsdl,
  matchSoapOperation
} from '../../src/shared/design/soapProjection'
import { importSoap } from '../../src/main/services/import/SoapImportService'
import { buildReferenceApiDesign } from './apiDesignReference'

const ADDRESS = 'http://localhost:7480/soap'

describe('designToWsdl', () => {
  const design = buildReferenceApiDesign()
  const wsdl = designToWsdl(design, ADDRESS)

  it('matches the golden WSDL', async () => {
    await expect(wsdl).toMatchFileSnapshot('./goldens/petstore.service.wsdl')
  })

  it('round-trips through the SOAP importer', () => {
    const folder = importSoap(wsdl, { name: 'Round trip' })
    const flat = JSON.stringify(folder)
    // One operation per design route, named after its operationId (or
    // the derived fallback), soapAction preserved.
    expect(flat).toContain('GetUser')
    expect(flat).toContain(`${designSoapNamespace(design)}#GetUser`)
    expect(flat).toContain(ADDRESS)
    expect(flat).toContain(designSoapServiceName(design))
  })
})

describe('operations and dispatch', () => {
  const design = buildReferenceApiDesign()
  const operations = designSoapOperations(design)

  it('derives one collision-free operation per route', () => {
    expect(operations).toHaveLength(3)
    expect(new Set(operations.map((o) => o.name)).size).toBe(operations.length)
    expect(operations.map((o) => o.name)).toContain('GetUser')
  })

  it('dispatches by SOAPAction, quoted or bare', () => {
    const action = operations[0]?.soapAction ?? ''
    expect(matchSoapOperation(operations, action, undefined)?.name).toBe(operations[0]?.name)
    expect(matchSoapOperation(operations, `"${action}"`, undefined)?.name).toBe(operations[0]?.name)
  })

  it('dispatches by the body root element when the action is absent', () => {
    expect(matchSoapOperation(operations, undefined, 'tns:GetUser')?.name).toBe('GetUser')
    expect(matchSoapOperation(operations, undefined, 'GetUserRequest')?.name).toBe('GetUser')
    expect(matchSoapOperation(operations, undefined, 'Unknown')).toBeUndefined()
  })

  it('answers with the bound model instance as XML', () => {
    const getUser = operations.find((o) => o.name === 'GetUser')
    expect(getUser).toBeDefined()
    if (getUser === undefined) return
    const envelope = buildSoapResponseEnvelope(design, getUser)
    expect(envelope).toContain('<GetUserResponse')
    expect(envelope).toContain('<email>admin@example.com</email>')
  })

  it('lists repeat the payload element', () => {
    const list = operations.find((o) => o.list)
    expect(list).toBeDefined()
    if (list === undefined) return
    const envelope = buildSoapResponseEnvelope(design, list)
    expect((envelope.match(/<User>/g) ?? []).length).toBeGreaterThan(1)
  })

  it('faults carry the detail', () => {
    const fault = buildSoapFaultEnvelope('No operation matches')
    expect(fault).toContain('<faultcode>soap:Client</faultcode>')
    expect(fault).toContain('No operation matches')
  })
})
