import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocketServer } from 'ws';
import { isLoopback, wireRelay } from './vite-plugin-relay.mjs';

// セキュリティの要（loopback 判定 / upgrade 振り分け）の回帰固定。実 socket は使わず、
// WebSocketServer.prototype.handleUpgrade を spy してブランチだけを検証する。

describe('isLoopback', () => {
  it('loopback とみなす（127.0.0.0/8 と ::1 / ::ffff:127.x）', () => {
    for (const addr of [
      '127.0.0.1', '127.0.0.2', '127.5.5.5', '127.255.255.255',
      '::1', '::ffff:127.0.0.1', '::ffff:127.5.5.5',
    ]) {
      expect(isLoopback(addr)).toBe(true);
    }
  });

  it('loopback ではない（LAN/外部/不明・IPv4-mapped の非loopback）', () => {
    for (const addr of [
      '10.0.0.1', '192.168.1.5', '172.18.188.130', '100.97.217.81', // tailnet も非loopback
      '::ffff:10.0.0.1', '::ffff:192.168.1.5', 'fe80::1', '0.0.0.0',
      undefined, '', null,
    ]) {
      expect(isLoopback(addr)).toBe(false);
    }
  });
});

describe('wireRelay — upgrade 振り分け', () => {
  let handleUpgradeSpy;

  beforeEach(() => {
    // 実 socket を触らせず、呼ばれたかどうかだけ見る。
    handleUpgradeSpy = vi
      .spyOn(WebSocketServer.prototype, 'handleUpgrade')
      .mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {}); // 起動ログを黙らせる
  });
  afterEach(() => vi.restoreAllMocks());

  // httpServer.on('upgrade', cb) で登録された cb を取り出すための偽サーバ。
  function fakeServer() {
    let upgradeHandler = null;
    const server = { httpServer: { on: (ev, cb) => { if (ev === 'upgrade') upgradeHandler = cb; } } };
    return { server, getHandler: () => upgradeHandler };
  }
  const fakeSocket = (remoteAddress) => ({ remoteAddress, destroy: vi.fn() });

  it('httpServer が無ければ何もしない（middlewareMode 等のガード）', () => {
    expect(() => wireRelay({ httpServer: null }, { expose: false, kind: 'dev' })).not.toThrow();
    expect(handleUpgradeSpy).not.toHaveBeenCalled();
  });

  it('/__relay 以外の upgrade は socket に触れない（HMR を奪わない）', () => {
    const { server, getHandler } = fakeServer();
    wireRelay(server, { expose: false, kind: 'dev' });
    const socket = fakeSocket('127.0.0.1');
    getHandler()({ url: '/' }, socket, Buffer.alloc(0)); // HMR の path '/'

    expect(socket.destroy).not.toHaveBeenCalled();
    expect(handleUpgradeSpy).not.toHaveBeenCalled();
  });

  it('既定(expose=false)で /__relay へ非 loopback から来たら destroy して拒否', () => {
    const { server, getHandler } = fakeServer();
    wireRelay(server, { expose: false, kind: 'dev' });
    const socket = fakeSocket('192.168.1.50'); // LAN
    getHandler()({ url: '/__relay?role=tx' }, socket, Buffer.alloc(0));

    expect(socket.destroy).toHaveBeenCalledTimes(1);
    expect(handleUpgradeSpy).not.toHaveBeenCalled();
  });

  it('expose=false でも loopback からの /__relay は handleUpgrade で受理', () => {
    const { server, getHandler } = fakeServer();
    wireRelay(server, { expose: false, kind: 'dev' });
    const socket = fakeSocket('127.0.0.1');
    getHandler()({ url: '/__relay?role=rx' }, socket, Buffer.alloc(0));

    expect(socket.destroy).not.toHaveBeenCalled();
    expect(handleUpgradeSpy).toHaveBeenCalledTimes(1);
  });

  it('expose=true なら非 loopback からの /__relay も受理（RELAY_EXPOSE=1 相当）', () => {
    const { server, getHandler } = fakeServer();
    wireRelay(server, { expose: true, kind: 'dev' });
    const socket = fakeSocket('100.97.217.81'); // tailnet 経由の別端末
    getHandler()({ url: '/__relay?role=tx' }, socket, Buffer.alloc(0));

    expect(socket.destroy).not.toHaveBeenCalled();
    expect(handleUpgradeSpy).toHaveBeenCalledTimes(1);
  });

  it('不正な URL の upgrade は握りつぶす（throw しない・socket 不可侵）', () => {
    const { server, getHandler } = fakeServer();
    wireRelay(server, { expose: false, kind: 'dev' });
    const socket = fakeSocket('127.0.0.1');
    expect(() => getHandler()({ url: 'http://[' }, socket, Buffer.alloc(0))).not.toThrow();
    expect(handleUpgradeSpy).not.toHaveBeenCalled();
  });
});
