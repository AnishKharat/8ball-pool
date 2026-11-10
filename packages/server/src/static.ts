import { createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

/** `GET /healthz`, the built client, and index.html for every other GET so `/r/CODE` links load the app. */
export function httpHandler(root: string) {
  const index = path.join(root, 'index.html');
  const built = existsSync(index);
  return (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
      return void res.end('ok');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' });
      return void res.end();
    }
    if (!built) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return void res.end('client not built: run npm run build');
    }
    // Resolve inside root only; anything else, or a miss, gets the app shell.
    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      res.writeHead(400);
      return void res.end();
    }
    let file = path.join(root, path.normalize(pathname));
    if (!file.startsWith(root + path.sep) || !existsSync(file) || !statSync(file).isFile()) file = index;
    const hashed = file.startsWith(path.join(root, 'assets') + path.sep);
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    if (req.method === 'HEAD') return void res.end();
    createReadStream(file).pipe(res);
  };
}
