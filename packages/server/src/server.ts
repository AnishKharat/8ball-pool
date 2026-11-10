import { createServer, type IncomingMessage } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { DEFAULT_ROOM_OPTIONS, RoomManager, type RoomOptions } from './rooms';

const RATE_BURST = 30; // messages a socket may send at once
const RATE_PER_SEC = 15; // sustained messages per second; aiming sends nothing, so play stays far below this
const SWEEP_MS = 10_000;

/** Token bucket per socket. Messages over the limit are dropped with a rejection. */
function rateLimit(socket: Socket) {
  let tokens = RATE_BURST;
  let last = Date.now();
  socket.use((_packet, next) => {
    const now = Date.now();
    tokens = Math.min(RATE_BURST, tokens + ((now - last) / 1000) * RATE_PER_SEC);
    last = now;
    if (tokens < 1) return void socket.emit('rejected', 'too many messages, slow down');
    tokens--;
    next();
  });
}

/** `ALLOWED_ORIGIN` is a comma-separated list. Unset allows any origin, which is fine for local development. */
export function originAllowed(allowed: string | undefined, req: IncomingMessage): boolean {
  if (!allowed) return true;
  const origin = req.headers.origin;
  return !!origin && allowed.split(',').map((o) => o.trim()).includes(origin);
}

export function createGameServer(options: Partial<RoomOptions> = {}, allowedOrigin = process.env.ALLOWED_ORIGIN) {
  const http = createServer();
  // allowRequest covers WebSocket upgrades too, which browsers don't hold to CORS.
  const io = new Server(http, {
    allowRequest: (req, done) => done(null, originAllowed(allowedOrigin, req)),
    maxHttpBufferSize: 10_000,
  });
  const rooms = new RoomManager(io, { ...DEFAULT_ROOM_OPTIONS, ...options });
  const sweep = setInterval(() => rooms.sweep(Date.now()), SWEEP_MS);
  sweep.unref();

  io.on('connection', (socket) => {
    rateLimit(socket);
    socket.on('playBot', (raw: unknown) => rooms.playBot(socket, raw));
    socket.on('createRoom', (raw: unknown) => rooms.createRoom(socket, raw));
    socket.on('joinRoom', (raw: unknown) => rooms.joinRoom(socket, raw));
    socket.on('resume', (raw: unknown) => rooms.resume(socket, raw));
    socket.on('leave', () => rooms.leave(socket));
    socket.on('sit', (raw: unknown) => rooms.sit(socket, raw));
    socket.on('ready', (raw: unknown) => rooms.ready(socket, raw));
    socket.on('start', () => rooms.start(socket));
    for (const kind of ['shot', 'place', 'call', 'choose'] as const) {
      socket.on(kind, (raw: unknown) => rooms.move(socket, kind, raw));
    }
    socket.on('disconnect', () => rooms.disconnect(socket));
  });
  const close = async () => {
    clearInterval(sweep);
    rooms.close();
    await io.close();
  };

  return { http, io, rooms, close };
}
