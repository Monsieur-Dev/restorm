/**
 * SOAP utility mock server for the restorm SOAP execution E2E suite.
 *
 * Castle Mock on :8090 requires manual web-UI seeding before it serves any
 * mock responses — that makes it unsuitable for a zero-friction CI start.
 * This tiny zero-dependency Node server fills that gap: it speaks SOAP 1.1
 * over plain HTTP, routes dispatch on the SOAPAction header, and returns
 * deterministic SOAP envelopes so the E2E matrix can assert wire-level
 * behaviour without any seeding step.
 *
 * Routes:
 *   POST /soap   — SOAP endpoint. Dispatched by the SOAPAction header:
 *
 *     …/Echo      → reflects the <message> element from the request body
 *                   back in <EchoResponse>/<message> (Handlebars-on-wire:
 *                   assert the substituted value appears in the response).
 *                   Also echoes a custom X-Request-Id response header so
 *                   the response-headers assertion can verify them.
 *
 *     …/Add       → parses <a> and <b>, responds with <result>a+b</result>.
 *     …/Subtract  → parses <a> and <b>, responds with <result>a-b</result>.
 *     …/Multiply  → parses <a> and <b>, responds with <result>a*b</result>.
 *     …/Divide    → parses <a> and <b>, responds with <result>a/b</result>.
 *                   Returns a SOAP Fault when <b> is 0.
 *
 *     …/Fault     → always returns a SOAP 1.1 Fault (faultcode SERVER,
 *                   faultstring "Fault triggered for testing").
 *
 *     …/Slow      → waits 8 s before responding (cancellation test).
 *
 *     …/Malformed → returns a non-XML body (clean-error test).
 *
 *   GET  /health  → 200 "ok" (readiness probe).
 *
 * The SOAP namespace used here matches soap-docker.wsdl's target namespace
 * (http://restorm.test/castlemock) so the existing sample YAML and the
 * new soap-sample.restorm can reuse the same namespace without changes.
 */

const http = require('http')

const PORT = process.env.PORT ? Number(process.env.PORT) : 8091
const NS = 'http://restorm.test/castlemock'

/** Read the full request body into a string. */
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', () => resolve(''))
  })
}

/**
 * Very lightweight XML element extractor — avoids pulling in a parser.
 * Returns the text content of the first occurrence of <localName>…</localName>
 * (namespace-prefix–agnostic). Returns '' if the element is absent.
 */
function extractElement(xml, localName) {
  const re = new RegExp(`<(?:[^:>]+:)?${localName}[^>]*>([^<]*)<\\/(?:[^:>]+:)?${localName}>`)
  const m = re.exec(xml)
  return m ? m[1].trim() : ''
}

/** Wrap a SOAP body element in a standard SOAP 1.1 envelope. */
function soapEnvelope(bodyContent) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<soap:Envelope',
    '  xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"',
    `  xmlns:tns="${NS}">`,
    '  <soap:Header/>',
    '  <soap:Body>',
    bodyContent,
    '  </soap:Body>',
    '</soap:Envelope>'
  ].join('\n')
}

/** SOAP 1.1 Fault envelope. */
function soapFaultEnvelope(code, message) {
  return soapEnvelope(
    `    <soap:Fault>
      <faultcode>${code}</faultcode>
      <faultstring>${message}</faultstring>
    </soap:Fault>`
  )
}

function sendSoap(res, body, extraHeaders) {
  const xml = soapEnvelope(body)
  res.writeHead(200, {
    'Content-Type': 'text/xml; charset=utf-8',
    'X-Soap-Mock': 'restorm-soap-server',
    ...(extraHeaders || {})
  })
  res.end(xml)
}

function sendFault(res, code, message) {
  const xml = soapFaultEnvelope(code, message)
  res.writeHead(500, { 'Content-Type': 'text/xml; charset=utf-8' })
  res.end(xml)
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const path = url.pathname

  // GET /health — readiness probe.
  if (req.method === 'GET' && path === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('ok')
    return
  }

  // All SOAP traffic comes in as POST /soap.
  if (req.method !== 'POST' || path !== '/soap') {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not found')
    return
  }

  const soapAction = (req.headers['soapaction'] || '').replace(/^"(.*)"$/, '$1').trim()
  const body = await readBody(req)

  // /Echo — reflect <message> back, echo the request-id header.
  if (soapAction.endsWith('/Echo')) {
    const message = extractElement(body, 'message') || '(empty)'
    const reqId = req.headers['x-request-id'] || ''
    sendSoap(
      res,
      `    <tns:EchoResponse>
      <tns:message>${message}</tns:message>
    </tns:EchoResponse>`,
      // Surface a custom response header so the response-headers assertion
      // can verify that headers are captured and displayed.
      reqId ? { 'X-Request-Id': reqId } : {}
    )
    return
  }

  // /Add, /Subtract, /Multiply, /Divide — arithmetic on <a> and <b>.
  const calcOps = { '/Add': (a, b) => a + b, '/Subtract': (a, b) => a - b, '/Multiply': (a, b) => a * b, '/Divide': (a, b) => a / b }
  for (const [suffix, fn] of Object.entries(calcOps)) {
    if (soapAction.endsWith(suffix)) {
      const a = Number(extractElement(body, 'a'))
      const b = Number(extractElement(body, 'b'))
      if (suffix === '/Divide' && b === 0) {
        sendFault(res, 'soap:Server', 'Division by zero')
        return
      }
      const result = fn(a, b)
      const opName = suffix.slice(1) // Add/Subtract/…
      sendSoap(
        res,
        `    <tns:${opName}Response>
      <tns:result>${result}</tns:result>
    </tns:${opName}Response>`
      )
      return
    }
  }

  // /Fault — always returns a SOAP Fault.
  if (soapAction.endsWith('/Fault')) {
    sendFault(res, 'soap:Server', 'Fault triggered for testing')
    return
  }

  // /Slow — respond after 8 s (cancellation test).
  if (soapAction.endsWith('/Slow')) {
    setTimeout(() => {
      sendSoap(res, '    <tns:SlowResponse><tns:message>slow</tns:message></tns:SlowResponse>')
    }, 8000)
    return
  }

  // /Malformed — return a non-XML body (clean malformed-XML error test).
  if (soapAction.endsWith('/Malformed')) {
    res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' })
    res.end('THIS IS NOT XML <<<>>> GARBAGE')
    return
  }

  // Unknown SOAPAction — return a generic fault.
  sendFault(res, 'soap:Client', `Unknown SOAPAction: ${soapAction}`)
})

server.listen(PORT, () => {
  console.log(`soap-server mock listening on :${PORT}`)
})
