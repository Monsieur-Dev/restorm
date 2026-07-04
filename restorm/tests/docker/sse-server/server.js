/**
 * SSE (Server-Sent Events) mock server for the restorm SSE execution E2E
 * suite. Pure `node:http`, no npm install, boots the instant the container
 * starts — same zero-dependency shape as `http-util` / `soap-server`.
 *
 * Routes:
 *   GET /events        → streams `?count=` (default 5) deterministic
 *                        labelled frames (`event: ping`, `data: <n>`,
 *                        `id: <n>`) spaced `?intervalMs=` (default 50ms)
 *                        apart, then keeps the connection open sending a
 *                        `:heartbeat` comment every second until the
 *                        client disconnects — never ends the response on
 *                        its own, so the app's reconnect logic is never
 *                        exercised by this route (that's the point: a
 *                        deterministic "N frames then steady" stream for
 *                        the base connect/assert/disconnect scenario and
 *                        for cancellation-mid-flight). An `X-Echo` request
 *                        header, if present, is echoed back as a leading
 *                        `event: echo` frame — proof that a Handlebars-
 *                        resolved header value reached the wire.
 *   GET /reconnect-test → exercises `Last-Event-ID` reconnect: with no
 *                        `Last-Event-ID` header, sends frames id=1..2 then
 *                        destroys the connection (simulated drop, no clean
 *                        end). A reconnect carrying `Last-Event-ID: 2`
 *                        resumes from frame 3 and completes normally
 *                        (frames 3..5, then keeps the connection open).
 *   GET /health         → 200 "ok" (readiness probe).
 */

const http = require('http')

const PORT = process.env.PORT ? Number(process.env.PORT) : 8097

/** True once a given reconnect-test client has already been dropped once
 * (keyed by nothing — this mock serves one logical client stream at a time,
 * which is all the deterministic E2E scenario needs). Reset per connect
 * when no `Last-Event-ID` is presented, so re-running the scenario from a
 * fresh app instance still exercises the drop. */
let reconnectTestDropped = false

function writeFrame(res, { event, data, id }) {
  if (id !== undefined) res.write(`id: ${id}\n`)
  if (event !== undefined) res.write(`event: ${event}\n`)
  res.write(`data: ${data}\n\n`)
}

function handleEvents(req, res, url) {
  const count = Number(url.searchParams.get('count') ?? 5)
  const intervalMs = Number(url.searchParams.get('intervalMs') ?? 50)
  // Echoes the `X-Echo` request header back as the very first frame, if
  // present — proof that a Handlebars/env-var value substituted into the
  // request headers actually reached the wire (mirrors grpcbin's metadata
  // echo, used the same way by the gRPC execution suite).
  const echoHeader = req.headers['x-echo']

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  })

  if (echoHeader !== undefined) writeFrame(res, { event: 'echo', data: String(echoHeader) })

  let sent = 0
  const sendNext = () => {
    if (res.writableEnded) return
    sent += 1
    writeFrame(res, { event: 'ping', data: String(sent), id: sent })
    if (sent < count) {
      setTimeout(sendNext, intervalMs)
      return
    }
    // All labelled frames sent — hold the connection open with periodic
    // heartbeats (comment lines, ignored by the parser) until the client
    // disconnects. A comment-only line never dispatches a frame.
    const heartbeat = setInterval(() => {
      if (res.writableEnded) { clearInterval(heartbeat); return }
      res.write(':heartbeat\n\n')
    }, 1000)
    req.on('close', () => clearInterval(heartbeat))
  }
  setTimeout(sendNext, intervalMs)
}

function handleReconnectTest(req, res) {
  const lastEventId = req.headers['last-event-id']

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  })

  if (!lastEventId && !reconnectTestDropped) {
    writeFrame(res, { event: 'ping', data: '1', id: 1 })
    writeFrame(res, { event: 'ping', data: '2', id: 2 })
    reconnectTestDropped = true
    // Simulated drop: destroy the socket without a clean end so the client's
    // reconnect logic (not the "stream ended cleanly" path) kicks in.
    setTimeout(() => { res.destroy() }, 20)
    return
  }

  const resumeFrom = Number(lastEventId ?? 0) + 1
  let sent = resumeFrom
  const sendNext = () => {
    if (res.writableEnded) return
    writeFrame(res, { event: 'ping', data: String(sent), id: sent })
    sent += 1
    if (sent <= 5) {
      setTimeout(sendNext, 30)
      return
    }
    const heartbeat = setInterval(() => {
      if (res.writableEnded) { clearInterval(heartbeat); return }
      res.write(':heartbeat\n\n')
    }, 1000)
    req.on('close', () => clearInterval(heartbeat))
  }
  setTimeout(sendNext, 20)
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`)

  if (req.method === 'GET' && url.pathname === '/events') {
    handleEvents(req, res, url)
    return
  }
  if (req.method === 'GET' && url.pathname === '/reconnect-test') {
    handleReconnectTest(req, res)
    return
  }
  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('ok')
    return
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' })
  res.end('not found')
})

server.listen(PORT, () => {
  console.log(`SSE mock server listening on :${PORT}`)
})
