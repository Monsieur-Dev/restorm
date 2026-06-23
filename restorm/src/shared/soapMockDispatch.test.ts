import { describe, it, expect } from 'vitest'
import {
  resolveSoapOperation,
  firstBodyOperationName,
  normalizeSoapAction,
  buildSoapResponse,
  buildUnmatchedFault
} from './soapMockDispatch'
import type { SoapMockOperation } from './types/requests/SoapRequest'

const ops: SoapMockOperation[] = [
  { name: 'Add', soapAction: 'urn:Add', responseBody: '<AddResult>7</AddResult>' },
  { name: 'Subtract', responseBody: '<SubtractResult>3</SubtractResult>' },
  { name: 'Boom', responseBody: 'it broke', isFault: true }
]

const envelope = (innerOp: string): string =>
  `<?xml version="1.0"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">`
  + `<soapenv:Body><tns:${innerOp} xmlns:tns="urn:calc"><a>4</a><b>3</b></tns:${innerOp}></soapenv:Body></soapenv:Envelope>`

describe('soapMockDispatch — operation resolution', () => {
  it('routes by SOAPAction header first (takes precedence over body)', () => {
    const op = resolveSoapOperation(ops, { soapAction: '"urn:Add"', body: envelope('Subtract') })
    expect(op?.name).toBe('Add')
  })

  it('routes by the first body operation name when no SOAPAction', () => {
    const op = resolveSoapOperation(ops, { body: envelope('Subtract') })
    expect(op?.name).toBe('Subtract')
  })

  it('returns undefined when nothing matches', () => {
    expect(resolveSoapOperation(ops, { body: envelope('Multiply') })).toBeUndefined()
    expect(resolveSoapOperation(undefined, { body: '' })).toBeUndefined()
  })

  it('normalizeSoapAction strips quotes + whitespace, empties → undefined', () => {
    expect(normalizeSoapAction('"urn:Add"')).toBe('urn:Add')
    expect(normalizeSoapAction('  urn:Add ')).toBe('urn:Add')
    expect(normalizeSoapAction('""')).toBeUndefined()
    expect(normalizeSoapAction(undefined)).toBeUndefined()
  })
})

describe('soapMockDispatch — firstBodyOperationName', () => {
  it('strips the namespace prefix and ignores Body/Envelope tags', () => {
    expect(firstBodyOperationName(envelope('GetWeather'))).toBe('GetWeather')
  })
  it('handles an un-prefixed Body + operation', () => {
    const xml = '<Envelope><Body><Echo><msg>hi</msg></Echo></Body></Envelope>'
    expect(firstBodyOperationName(xml)).toBe('Echo')
  })
  it('returns undefined for an empty body', () => {
    expect(firstBodyOperationName('<Envelope><Body></Body></Envelope>')).toBeUndefined()
    expect(firstBodyOperationName('')).toBeUndefined()
  })
})

describe('soapMockDispatch — response building', () => {
  it('wraps a canned inner body in a SOAP 1.1 envelope with status 200', () => {
    const res = buildSoapResponse(ops[0])
    expect(res.status).toBe(200)
    expect(res.xml).toContain('<soap:Envelope')
    expect(res.xml).toContain('<soap:Body><AddResult>7</AddResult></soap:Body>')
  })

  it('serves a full envelope responseBody verbatim', () => {
    const full = '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><X/></soap:Body></soap:Envelope>'
    const res = buildSoapResponse({ name: 'X', responseBody: full })
    expect(res.xml).toBe(full)
  })

  it('a fault operation returns status 500 with a <soap:Fault>', () => {
    const res = buildSoapResponse(ops[2])
    expect(res.status).toBe(500)
    expect(res.xml).toContain('<soap:Fault>')
    expect(res.xml).toContain('<faultstring>it broke</faultstring>')
  })

  it('a fault responseBody that already contains a Fault is used as-is', () => {
    const res = buildSoapResponse({ name: 'F', isFault: true, responseBody: '<soap:Fault><faultcode>soap:Client</faultcode><faultstring>bad</faultstring></soap:Fault>' })
    expect(res.status).toBe(500)
    expect(res.xml).toContain('<faultcode>soap:Client</faultcode>')
  })

  it('the unmatched fault names the operation and is a 500 Fault', () => {
    const res = buildUnmatchedFault('Multiply')
    expect(res.status).toBe(500)
    expect(res.xml).toContain('<soap:Fault>')
    expect(res.xml).toContain('Multiply')
  })

  it('escapes XML metacharacters in a bare fault message', () => {
    const res = buildSoapResponse({ name: 'F', isFault: true, responseBody: 'a < b & c' })
    expect(res.xml).toContain('a &lt; b &amp; c')
  })
})
