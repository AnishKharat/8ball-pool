import { createGameServer } from './server';

const SHUTDOWN_GRACE_MS = 10_000; // Render waits 30 s after SIGTERM before SIGKILL

const port = Number(process.env.PORT) || 3000;
const { http, close } = createGameServer();
http.listen(port, '0.0.0.0', () => console.log('listening on', port));

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`${signal}: shutting down`);
  // Rooms live in memory, so they end here: each player is told the room closed before the sockets drop.
  setTimeout(() => process.exit(1), SHUTDOWN_GRACE_MS).unref();
  await close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
