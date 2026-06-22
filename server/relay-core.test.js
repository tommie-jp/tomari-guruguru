import { describe, it, expect, vi } from 'vitest';
import { createRelayHub, attachRelay, roleOf } from './relay-core.mjs';

// 偽 WebSocket。relay-core が使うのは readyState / send / on('message'|'close') のみ。
// on で登録したハンドラを emit(event, ...args) で発火できるようにする。
function fakeSocket(readyState = 1) {
  const handlers = {};
  return {
    readyState,
    send: vi.fn(),
    on: vi.fn((event, cb) => { handlers[event] = cb; }),
    emit(event, ...args) { handlers[event]?.(...args); },
  };
}

describe('roleOf', () => {
  it('?role を解析する（パス非依存）', () => {
    expect(roleOf({ url: '/?role=rx' })).toBe('rx');
    expect(roleOf({ url: '/__relay?role=tx' })).toBe('tx');
  });

  it('role 未指定は null', () => {
    expect(roleOf({ url: '/' })).toBeNull();
    expect(roleOf({ url: '/__relay' })).toBeNull();
    expect(roleOf({ url: undefined })).toBeNull(); // 'undefined' に解決され role 無し
  });

  it('不正な URL は catch して null（throw を握りつぶす＝接続は producer 既定へ）', () => {
    expect(roleOf({ url: 'http://[' })).toBeNull(); // Invalid URL → catch 分岐を直撃
  });
});

describe('createRelayHub — 中継ロジック', () => {
  it('producer のメッセージは接続中の全 consumer へブロードキャストされる（自分には届かない）', () => {
    // Arrange
    const hub = createRelayHub();
    const rx1 = fakeSocket();
    const rx2 = fakeSocket();
    const tx = fakeSocket();
    hub.handleConnection(rx1, 'rx');
    hub.handleConnection(rx2, 'rx');
    hub.handleConnection(tx, undefined); // 既定 = producer
    tx.send.mockClear(); // 接続時の need-config/peer を除外して broadcast だけ見る

    // Act
    tx.emit('message', '{"state":1}', false);

    // Assert
    expect(rx1.send).toHaveBeenCalledWith('{"state":1}');
    expect(rx2.send).toHaveBeenCalledWith('{"state":1}');
    expect(tx.send).not.toHaveBeenCalled(); // producer 自身には返らない
  });

  it('text フレーム(Buffer, isBinary=false)は文字列化して中継する', () => {
    // Arrange: 本番 ws は data を Buffer で渡す。text のときは toString() される。
    const hub = createRelayHub();
    const rx = fakeSocket();
    const tx = fakeSocket();
    hub.handleConnection(rx, 'rx');
    hub.handleConnection(tx, undefined);

    // Act
    tx.emit('message', Buffer.from('{"state":1}'), false);

    // Assert: 文字列で届く（Buffer のままではない）
    expect(rx.send).toHaveBeenCalledWith('{"state":1}');
  });

  it('binary フレーム(isBinary=true)は変換せずそのまま中継する', () => {
    // Arrange
    const hub = createRelayHub();
    const rx = fakeSocket();
    const tx = fakeSocket();
    hub.handleConnection(rx, 'rx');
    hub.handleConnection(tx, undefined);
    const buf = Buffer.from([1, 2, 3]);

    // Act
    tx.emit('message', buf, true);

    // Assert: 同一の Buffer がそのまま渡る
    expect(rx.send).toHaveBeenCalledWith(buf);
  });

  it('consumer が 0 台でも producer の message は throw せず誰にも飛ばない', () => {
    // Arrange
    const hub = createRelayHub();
    const tx = fakeSocket();
    hub.handleConnection(tx, undefined); // rx 不在
    tx.send.mockClear();

    // Act / Assert
    expect(() => tx.emit('message', '{"state":1}', false)).not.toThrow();
    expect(tx.send).not.toHaveBeenCalled();
  });

  it('rx 接続時、複数の live producer 全員へ need-config + peer が一斉配布される', () => {
    // Arrange: producer を 2 台先に繋ぐ
    const hub = createRelayHub();
    const tx1 = fakeSocket();
    const tx2 = fakeSocket();
    hub.handleConnection(tx1, undefined);
    hub.handleConnection(tx2, undefined);
    tx1.send.mockClear();
    tx2.send.mockClear();

    // Act
    hub.handleConnection(fakeSocket(), 'rx');

    // Assert: 両 producer に need-config と peer(count:1)
    for (const tx of [tx1, tx2]) {
      expect(tx.send).toHaveBeenNthCalledWith(1, JSON.stringify({ type: 'need-config' }));
      expect(tx.send).toHaveBeenNthCalledWith(2, JSON.stringify({
        type: 'peer', role: 'rx', event: 'connect', count: 1,
      }));
    }
  });

  it('rx 接続時に既存 producer へ need-config と peer(connect,count) が届く', () => {
    // Arrange
    const hub = createRelayHub();
    const tx = fakeSocket();
    hub.handleConnection(tx, undefined);
    tx.send.mockClear();

    // Act
    hub.handleConnection(fakeSocket(), 'rx');

    // Assert
    expect(tx.send).toHaveBeenNthCalledWith(1, JSON.stringify({ type: 'need-config' }));
    expect(tx.send).toHaveBeenNthCalledWith(2, JSON.stringify({
      type: 'peer', role: 'rx', event: 'connect', count: 1,
    }));
  });

  it('rx 切断時に producer へ peer(disconnect,count) 通知が届く', () => {
    // Arrange
    const hub = createRelayHub();
    const tx = fakeSocket();
    const rx = fakeSocket();
    hub.handleConnection(tx, undefined);
    hub.handleConnection(rx, 'rx');
    tx.send.mockClear();

    // Act
    rx.emit('close');

    // Assert
    expect(tx.send).toHaveBeenCalledWith(JSON.stringify({
      type: 'peer', role: 'rx', event: 'disconnect', count: 0,
    }));
    expect(hub.consumers.size).toBe(0);
  });

  it('後発 producer は既存 rx が居れば即 need-config + peer を受け取る', () => {
    // Arrange
    const hub = createRelayHub();
    hub.handleConnection(fakeSocket(), 'rx'); // producer 不在なので誰にも飛ばない
    const tx = fakeSocket();

    // Act
    hub.handleConnection(tx, undefined);

    // Assert
    expect(tx.send).toHaveBeenNthCalledWith(1, JSON.stringify({ type: 'need-config' }));
    expect(tx.send).toHaveBeenNthCalledWith(2, JSON.stringify({
      type: 'peer', role: 'rx', event: 'connect', count: 1,
    }));
  });

  it('consumer から来たメッセージは中継されない（rx に message ハンドラを張らない）', () => {
    // Arrange
    const hub = createRelayHub();
    const tx = fakeSocket();
    const rx = fakeSocket();
    hub.handleConnection(tx, undefined);
    hub.handleConnection(rx, 'rx');
    tx.send.mockClear();

    // Assert: rx には close のみ登録され message は無い
    const rxEvents = rx.on.mock.calls.map((c) => c[0]);
    expect(rxEvents).toContain('close');
    expect(rxEvents).not.toContain('message');
    expect(tx.send).not.toHaveBeenCalled();
  });

  it('readyState!==1 の宛先には送信しない（send/broadcast のガード）', () => {
    // Arrange
    const hub = createRelayHub();
    const deadProducer = fakeSocket(0); // CONNECTING（peer通知の対象外になるべき）
    hub.handleConnection(deadProducer, undefined);
    const openRx = fakeSocket(1);
    const deadRx = fakeSocket(0);
    hub.handleConnection(openRx, 'rx');  // ← この時 requestConfigAndNotify(deadProducer) は送らない
    hub.handleConnection(deadRx, 'rx');
    const tx = fakeSocket();
    hub.handleConnection(tx, undefined);
    tx.send.mockClear();

    // Act
    tx.emit('message', 'payload', false);

    // Assert
    expect(deadProducer.send).not.toHaveBeenCalled(); // send() ガード
    expect(deadRx.send).not.toHaveBeenCalled();        // broadcast() ガード
    expect(openRx.send).toHaveBeenCalledWith('payload');
  });
});

describe('attachRelay', () => {
  it('wss の connection を roleOf で振り分けて handleConnection に渡す', () => {
    // Arrange: 偽 wss
    let connHandler;
    const wss = { on: vi.fn((ev, cb) => { if (ev === 'connection') connHandler = cb; }) };
    const hub = attachRelay(wss);
    const tx = fakeSocket();
    const rx = fakeSocket();

    // Act: rx 接続 → tx 接続（tx は既存 rx ありで need-config を受ける）
    connHandler(rx, { url: '/__relay?role=rx' });
    connHandler(tx, { url: '/__relay?role=tx' });

    // Assert
    expect(hub.consumers.size).toBe(1);
    expect(hub.producers.size).toBe(1);
    expect(tx.send).toHaveBeenCalledWith(JSON.stringify({ type: 'need-config' }));
  });
});
