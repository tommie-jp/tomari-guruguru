import { describe, it, expect } from 'vitest';
import { parseRelayMode, defaultRelayUrl } from './relay-mode';

describe('parseRelayMode', () => {
  it('パラメータ無しは local', () => {
    expect(parseRelayMode('').mode).toBe('local');
  });

  it('?tx / ?tx=ws は tx', () => {
    expect(parseRelayMode('?tx').mode).toBe('tx');
    expect(parseRelayMode('?tx=ws').mode).toBe('tx');
  });

  it('?rx / ?rx=ws は rx', () => {
    expect(parseRelayMode('?rx').mode).toBe('rx');
    expect(parseRelayMode('?rx=ws').mode).toBe('rx');
  });

  it('tx と rx の同時指定は tx を優先', () => {
    expect(parseRelayMode('?tx&rx').mode).toBe('tx');
  });

  it('?relay= で URL を明示上書き', () => {
    expect(parseRelayMode('?rx&relay=wss://host:9000').relayUrl).toBe('wss://host:9000');
  });

  it('既定 URL は同ホストの :8787（https なら wss）', () => {
    const url = parseRelayMode('?tx', { protocol: 'https:', hostname: '100.64.0.2' }).relayUrl;
    expect(url).toBe('wss://100.64.0.2:8787');
  });

  it('http なら ws を選ぶ', () => {
    expect(defaultRelayUrl({ protocol: 'http:', hostname: 'localhost' })).toBe('ws://localhost:8787');
  });
});
