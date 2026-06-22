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

  it('?relay= で URL を明示上書き（同一オリジン化の影響を受けない）', () => {
    expect(parseRelayMode('?rx&relay=wss://host:9000').relayUrl).toBe('wss://host:9000');
  });

  it('既定 URL は同一オリジン（host）＋ /__relay（https なら wss）', () => {
    const url = parseRelayMode('?tx', { protocol: 'https:', host: '100.64.0.2:8787' }).relayUrl;
    expect(url).toBe('wss://100.64.0.2:8787/__relay');
  });

  it('http なら ws を選ぶ。host の port をそのまま引き継ぐ（同一オリジン）', () => {
    expect(defaultRelayUrl({ protocol: 'http:', host: 'localhost:5173' })).toBe('ws://localhost:5173/__relay');
    expect(defaultRelayUrl({ protocol: 'http:', host: 'wsl40:8787' })).toBe('ws://wsl40:8787/__relay');
  });

  it('host が無ければ hostname、それも無ければ localhost にフォールバック', () => {
    expect(defaultRelayUrl({ protocol: 'http:', hostname: 'example' })).toBe('ws://example/__relay');
    expect(defaultRelayUrl({ protocol: 'http:' })).toBe('ws://localhost/__relay');
  });
});
