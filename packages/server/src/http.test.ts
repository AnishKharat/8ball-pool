import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGameServer } from './server';

describe('http', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'chalkline-'));
  mkdirSync(path.join(root, 'assets'));
  writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>Chalkline</title>');
  writeFileSync(path.join(root, 'assets', 'app-1234.js'), 'console.log(1)');
  writeFileSync(path.join(path.dirname(root), 'secret.txt'), 'nope');
  const server = createGameServer({}, undefined, root);
  let base = '';

  beforeAll(async () => {
    await new Promise<void>((r) => server.http.listen(0, r));
    base = `http://localhost:${(server.http.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  it('answers the health check', async () => {
    const r = await fetch(`${base}/healthz`);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('ok');
  });

  it('serves the app shell for / and for shared room links', async () => {
    for (const p of ['/', '/r/ABCDEF', '/anything/else']) {
      const r = await fetch(base + p);
      expect(r.status).toBe(200);
      expect(r.headers.get('content-type')).toMatch(/text\/html/);
      expect(r.headers.get('cache-control')).toBe('no-cache');
      expect(await r.text()).toContain('<title>Chalkline</title>');
    }
  });

  it('serves hashed assets with long caching', async () => {
    const r = await fetch(`${base}/assets/app-1234.js`);
    expect(r.headers.get('content-type')).toMatch(/javascript/);
    expect(r.headers.get('cache-control')).toMatch(/immutable/);
    expect(await r.text()).toBe('console.log(1)');
  });

  it('never serves files outside the client folder', async () => {
    for (const p of ['/../secret.txt', '/%2e%2e/secret.txt', '/assets/%2e%2e/%2e%2e/secret.txt']) {
      const text = await (await fetch(base + p)).text();
      expect(text).not.toContain('nope');
    }
    expect((await fetch(`${base}/%E0%A4%A`)).status).toBe(400);
  });

  it('refuses other methods', async () => {
    expect((await fetch(`${base}/`, { method: 'POST' })).status).toBe(405);
  });

  it('still answers Socket.IO on the same port', async () => {
    const r = await fetch(`${base}/socket.io/?EIO=4&transport=polling`);
    expect(r.status).toBe(200);
    expect(await r.text()).toMatch(/"sid"/);
  });
});
