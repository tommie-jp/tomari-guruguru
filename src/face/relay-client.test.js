import { describe, it, expect, vi } from 'vitest';
import { createRelayClient } from './relay-client';

// 最小の WebSocket スタブ。テストから open/message/close を手動で発火する。
class FakeSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0; // CONNECTING
    this.sent = [];
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
  }

  open() { this.readyState = 1; this.onopen?.(); }
  recv(obj) { this.onmessage?.({ data: JSON.stringify(obj) }); }
  recvRaw(str) { this.onmessage?.({ data: str }); }
  send(payload) { this.sent.push(payload); }
  close() { this.readyState = 3; this.onclose?.(); }
}

function setup(handlers = {}) {
  let socket;
  const client = createRelayClient({
    url: 'ws://localhost:8787',
    role: 'rx',
    makeSocket: (u) => { socket = new FakeSocket(u); return socket; },
    ...handlers,
  });
  return { client, get: () => socket };
}

describe('createRelayClient', () => {
  it('URL に role を付与する', () => {
    const { get } = setup();
    expect(get().url).toBe('ws://localhost:8787?role=rx');
  });

  it('配列メッセージは onState に渡る', () => {
    const onState = vi.fn();
    const { get } = setup({ onState });
    get().open();
    get().recv([1, 0.5, -0.5, 0, 0, 0, 1, 2]);
    expect(onState).toHaveBeenCalledWith([1, 0.5, -0.5, 0, 0, 0, 1, 2]);
  });

  it('config / need-config / peer は type で振り分ける', () => {
    const onConfig = vi.fn();
    const onNeedConfig = vi.fn();
    const onPeer = vi.fn();
    const { get } = setup({ onConfig, onNeedConfig, onPeer });
    get().open();
    get().recv({ type: 'config', tweaks: { smoothing: 0.3 } });
    get().recv({ type: 'need-config' });
    get().recv({ type: 'peer', event: 'connect', count: 1 });
    expect(onConfig).toHaveBeenCalledWith({ smoothing: 0.3 });
    expect(onNeedConfig).toHaveBeenCalledTimes(1);
    expect(onPeer).toHaveBeenCalledWith({ type: 'peer', event: 'connect', count: 1 });
  });

  it('cue は onCue に id を渡す（演出のリレー転送）', () => {
    const onCue = vi.fn();
    const { get } = setup({ onCue });
    get().open();
    get().recv({ type: 'cue', id: 'hello' });
    expect(onCue).toHaveBeenCalledWith('hello');
  });

  it('sendCue は {type:cue,id} を送る', () => {
    const { client, get } = setup();
    get().open();
    client.sendCue('clap');
    expect(JSON.parse(get().sent[0])).toEqual({ type: 'cue', id: 'clap' });
  });

  it('壊れた JSON は無視して落ちない', () => {
    const onState = vi.fn();
    const { get } = setup({ onState });
    get().open();
    expect(() => get().recvRaw('not json')).not.toThrow();
    expect(onState).not.toHaveBeenCalled();
  });

  it('接続中は sendState/sendConfig が送信される', () => {
    const { client, get } = setup();
    get().open();
    client.sendState([1, 0, 0, 0, 0, 0, 1, 0]);
    client.sendConfig({ smoothing: 0.3 });
    expect(get().sent).toHaveLength(2);
    expect(JSON.parse(get().sent[0])).toEqual([1, 0, 0, 0, 0, 0, 1, 0]);
    expect(JSON.parse(get().sent[1])).toEqual({ type: 'config', tweaks: { smoothing: 0.3 } });
  });

  it('未接続(CONNECTING)では送信を握りつぶす', () => {
    const { client, get } = setup();
    // open していない → readyState=0
    client.sendState([1, 0, 0, 0, 0, 0, 1, 0]);
    expect(get().sent).toHaveLength(0);
  });

  it('onStatus が open/close で接続状態を通知する', () => {
    const onStatus = vi.fn();
    const { client, get } = setup({ onStatus });
    get().open();
    expect(onStatus).toHaveBeenCalledWith({ connected: true });
    client.close();
    expect(onStatus).toHaveBeenCalledWith({ connected: false });
  });
});
