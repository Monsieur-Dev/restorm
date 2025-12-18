const { Server } = require('socket.io');

const io = new Server(3001, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

console.log('Socket.IO test server running on port 3001');

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Echo event - returns the same data back
  socket.on('echo', (data) => {
    console.log(`Echo received: ${JSON.stringify(data)}`);
    socket.emit('echo', data);
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
    console.log(`${socket.id} joined room: ${room}`);
  });

  socket.on('leave-room', (room) => {
    socket.leave(room);
    socket.emit('left', { room });
    console.log(`${socket.id} left room: ${room}`);
  });

  socket.on('room-message', ({ room, message }) => {
    io.to(room).emit('room-message', {
      from: socket.id,
      room,
      message,
      timestamp: Date.now(),
    });
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});
