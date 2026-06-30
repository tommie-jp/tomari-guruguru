// 内蔵サーバ（electron/embedded-server.mjs）の headless テスト。
// electron に依存しない純 Node モジュールなので Vitest(node 環境)でそのまま検証できる。
// 確認: ルート→index.html 配信 / サブファイル / 404 / パストラバーサル拒否 / /__relay の tx→rx 中継。
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { createEmbeddedServer } from './embedded-server.mjs';

// dist-local に依存しない自己完結の一時 webRoot。
const root = mkdtempSync(join(tmpdir(), 'guru-embed-'));
writeFileSync(join(root, 'index.html'), '<!doctype html><title>ok</title>hello-root');
mkdirSync(join(root, 'sub'));
writeFileSync(join(root, 'sub', 'a.txt'), 'aaa');

let srv;

afterAll(() => {
  if (srv?.server) srv.server.close();
  rmSync(root, { recursive: true, force: true });
});

describe('embedded-server', () => {
  it('serves / as index.html and a subfile (200)', async () => {
    srv = await createEmbeddedServer({ webRoot: root, host: '127.0.0.1', port: 0 });
    expect(srv.port).toBeGreaterThan(0);
    const base = `http://127.0.0.1:${srv.port}`;

    const r1 = await fetch(`${base}/`);
    expect(r1.status).toBe(200);
    expect(r1.headers.get('content-type')).toContain('text/html');
    expect(await r1.text()).toContain('hello-root');

    const r2 = await fetch(`${base}/sub/a.txt`);
    expect(r2.status).toBe(200);
    expect(await r2.text()).toBe('aaa');
  });

  it('404 for missing file, and never serves outside the root', async () => {
    const base = `http://127.0.0.1:${srv.port}`;
    expect((await fetch(`${base}/nope.txt`)).status).toBe(404);
    // %2e%2e%2f = "../"。root の外（/etc/passwd）を狙う。403(拒否) か 404 で、決して 200 にしない。
    const trav = await fetch(`${base}/%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd`);
    expect(trav.status).not.toBe(200);
    expect([403, 404]).toContain(trav.status);
  });

  it('relays a frame from a tx producer to an rx consumer via /__relay', async () => {
    const wsBase = `ws://127.0.0.1:${srv.port}/__relay`;
    const rx = new WebSocket(`${wsBase}?role=rx`);
    await new Promise((res, rej) => { rx.once('open', res); rx.once('error', rej); });
    const tx = new WebSocket(`${wsBase}?role=tx`);
    await new Promise((res, rej) => { tx.once('open', res); tx.once('error', rej); });

    const received = new Promise((res) => rx.once('message', (d) => res(d.toString())));
    tx.send(JSON.stringify([1, 2, 3]));
    expect(await received).toBe('[1,2,3]');

    rx.close();
    tx.close();
  });

  it('rejects a websocket upgrade on a non-/__relay path', async () => {
    const bad = new WebSocket(`ws://127.0.0.1:${srv.port}/nope`);
    const errored = await new Promise((res) => {
      bad.once('open', () => res(false));
      bad.once('error', () => res(true));
    });
    expect(errored).toBe(true);
  });
});
