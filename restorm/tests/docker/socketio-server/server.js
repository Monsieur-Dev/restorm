const http = require('http');
const { Server } = require('socket.io');

const PORT = 3001;

// Plain HTTP server so we can expose a classic REST route alongside Socket.IO.
// GET/POST /emit?event=<name>&data=<json>&ns=</chat>  →  pushes <event> to every
// client connected on the namespace (default "/"). Lets an external caller
// trigger a server→client event for listen/streaming tests.
const httpServer = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === '/emit') {
    const event = url.searchParams.get('event') || 'message';
    const ns = url.searchParams.get('ns') || '/';
    const rawData = url.searchParams.get('data');
    let data;
    try {
      data = rawData != null ? JSON.parse(rawData) : { triggeredAt: Date.now() };
    } catch {
      data = rawData;
    }
    io.of(ns).emit(event, data);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, emitted: { ns, event, data } }));
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'not found' }));
});

const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  // Allow binary payloads up to 10 MB so binary round-trip tests pass.
  maxHttpBufferSize: 1e7,
});

httpServer.listen(PORT, () => {
  console.log(`Socket.IO test server running on port ${PORT}`);
  console.log(`HTTP trigger: GET http://localhost:${PORT}/emit?event=<name>&data=<json>`);
});

/**
 * Default namespace "/" — open, no auth.
 * Covers: echo (emit-back + ack), ack-only, binary round-trip, ping/pong,
 * broadcast, rooms, and a force-disconnect hook for reconnect testing.
 */
io.on('connection', (socket) => {
  console.log(`[/] Client connected: ${socket.id}`);

  // Echo - returns the same data back, AND acknowledges if the client
  // emitted with an ack callback (last argument is a function).
  socket.on('echo', (data, ack) => {
    console.log(`[/] echo: ${JSON.stringify(data)}`);
    socket.emit('echo', data);
    if (typeof ack === 'function') ack(data);
  });

  // Ack-only - responds solely through the acknowledgement callback.
  socket.on('echo:ack', (data, ack) => {
    if (typeof ack === 'function') ack({ echoed: data, at: Date.now() });
  });

  // Binary round-trip - payload is a Buffer/ArrayBuffer; return it untouched.
  socket.on('binary', (payload, ack) => {
    if (typeof ack === 'function') ack(payload);
    else socket.emit('binary', payload);
  });

  // Ping event - returns pong
  socket.on('ping', () => {
    socket.emit('pong', { timestamp: Date.now() });
  });

  // Broadcast event - sends to all connected clients
  socket.on('broadcast', (data) => {
    io.emit('broadcast', {
      from: socket.id,
      data,
      timestamp: Date.now(),
    });
  });

  // Room events
  socket.on('join-room', (room) => {
    socket.join(room);
    socket.emit('joined', { room });
    console.log(`[/] ${socket.id} joined room: ${room}`);
  });

  socket.on('leave-room', (room) => {
    socket.leave(room);
    socket.emit('left', { room });
    console.log(`[/] ${socket.id} left room: ${room}`);
  });

  socket.on('room-message', ({ room, message }) => {
    io.to(room).emit('room-message', {
      from: socket.id,
      room,
      message,
      timestamp: Date.now(),
    });
  });

  // Reconnect testing - let the client ask the server to drop the connection.
  socket.on('force-disconnect', () => {
    console.log(`[/] force-disconnect: ${socket.id}`);
    socket.disconnect(true);
  });

  socket.on('disconnect', (reason) => {
    console.log(`[/] Client disconnected: ${socket.id} (${reason})`);
  });
});

/**
 * Auth-protected namespace "/chat".
 * Requires a handshake auth payload: { token: "secret-token" }.
 * Exercises namespace routing + connection-time authentication.
 */
const chat = io.of('/chat');

chat.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (token === 'secret-token') return next();
  next(new Error('unauthorized'));
});

chat.on('connection', (socket) => {
  console.log(`[/chat] Client connected: ${socket.id}`);
  socket.emit('welcome', { namespace: '/chat', id: socket.id });

  socket.on('echo', (data, ack) => {
    socket.emit('echo', data);
    if (typeof ack === 'function') ack(data);
  });

  socket.on('message', (data) => {
    chat.emit('message', {
      from: socket.id,
      data,
      timestamp: Date.now(),
    });
  });

  socket.on('disconnect', (reason) => {
    console.log(`[/chat] Client disconnected: ${socket.id} (${reason})`);
  });
});
