import { describe, it, expect } from 'vitest'
import { parseSoapFault } from './SOAPExecutionService'

describe('parseSoapFault', () => {
  it('parses a SOAP 1.1 fault (faultcode / faultstring)', () => {
    const xml = `<?xml version="1.0"?>
      <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
        <soap:Body>
          <soap:Fault>
            <faultcode>soap:Server</faultcode>
            <faultstring>Something broke</faultstring>
          </soap:Fault>
        </soap:Body>
      </soap:Envelope>`
    expect(parseSoapFault(xml)).toEqual({ code: 'soap:Server', message: 'Something broke' })
  })

  it('parses a SOAP 1.2 fault (Code/Value, Reason/Text)', () => {
    const xml = `<?xml version="1.0"?>
      <env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope">
        <env:Body>
          <env:Fault>
            <env:Code><env:Value>env:Receiver</env:Value></env:Code>
            <env:Reason><env:Text xml:lang="en">Processing error</env:Text></env:Reason>
          </env:Fault>
        </env:Body>
      </env:Envelope>`
    expect(parseSoapFault(xml)).toEqual({ code: 'env:Receiver', message: 'Processing error' })
  })

  it('decodes entity-encoded fault text (the old regex left these raw)', () => {
    const xml = `<soap:Fault xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
      <faultcode>soap:Client</faultcode>
      <faultstring>bad value: a &lt; b &amp; c</faultstring>
    </soap:Fault>`
    expect(parseSoapFault(xml)?.message).toBe('bad value: a < b & c')
  })

  it('returns undefined when there is no Fault element', () => {
    expect(parseSoapFault('<soap:Envelope><soap:Body><Ok/></soap:Body></soap:Envelope>')).toBeUndefined()
  })

  it('returns undefined for unparseable input', () => {
    expect(parseSoapFault('not xml at all <<<')).toBeUndefined()
  })
})
