const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = 3002;

/**
 * Plain HTTP server, doubling as the raw-WebSocket host.
 *
 *  GET  /                       → 200 health probe (used by wait-for-services).
 *  GET  /push?data=<json|text>  → pushes a server→client frame to every open
 *                                 socket. Lets an external caller trigger a
 *                                 server-initiated message for listen/streaming
 *                                 tests (the raw-WS analogue of the Socket.IO
 *                                 server's /emit route).
 *  GET  /close                  → asks every open socket to close (server-
 *                                 initiated close for reconnect / close-code tests).
 */
const httpServer = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === '/push') {
    const raw = url.searchParams.get('data');
    const payload = raw != null ? raw : JSON.stringify({ pushedAt: Date.now() });
    let n = 0;
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) { client.send(payload); n += 1; }
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, pushed: payload, clients: n }));
    return;
  }
  if (url.pathname === '/close') {
    const code = Number(url.searchParams.get('code') || 1000);
    const reason = url.searchParams.get('reason') || 'server requested close';
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) client.close(code, reason);
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, closing: wss.clients.size, code }));
    return;
  }
  if (url.pathname === '/' || url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'ws-echo' }));
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'not found' }));
});

/**
 * Raw WebSocket echo server.
 *  - Negotiates a `Sec-WebSocket-Protocol` subprotocol when the client offers
 *    one we recognise (`echo-protocol`), proving subprotocol selection.
 *  - When the connection URL carries `?hello=1`, sends a `welcome` frame echoing
 *    the negotiated protocol + the `x-echo-header` request header (proves custom
 *    headers reached the server). Off by default so a plain connection's message
 *    stream is pure echo (deterministic for scenario run-logs).
 *  - Echoes every text frame back verbatim, and every binary frame back as the
 *    same bytes (covers text, binary, and >64KB large/fragmented frames).
 *  - Replies to a `__ping__` text frame with `__pong__` (an application-level
 *    keep-alive observable in the message history) AND issues a protocol ping.
 */
const wss = new WebSocketServer({
  server: httpServer,
  maxPayload: 16 * 1024 * 1024, // 16 MB so large-message tests pass.
  handleProtocols: (protocols) => (protocols.has('echo-protocol') ? 'echo-protocol' : false),
});

httpServer.listen(PORT, () => {
  console.log(`Raw WebSocket echo server running on port ${PORT}`);
  console.log(`HTTP trigger: GET http://localhost:${PORT}/push?data=<json>`);
});

wss.on('connection', (socket, request) => {
  console.log('[ws] client connected');
  const wantsHello = new URL(request.url, `http://localhost:${PORT}`).searchParams.get('hello') === '1';
  if (wantsHello) {
    socket.send(JSON.stringify({
      type: 'welcome',
      protocol: socket.protocol || null,
      echoHeader: request.headers['x-echo-header'] || null,
    }));
  }

  socket.on('message', (data, isBinary) => {
    if (isBinary) { socket.send(data, { binary: true }); return; }
    const text = data.toString();
    if (text === '__ping__') { socket.send('__pong__'); socket.ping(); return; }
    socket.send(text);
  });

  socket.on('close', (code, reason) => {
    console.log(`[ws] client disconnected (${code} ${reason})`);
  });
});
