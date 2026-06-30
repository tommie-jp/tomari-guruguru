// tailscale.mjs のパース部（純関数）を検証する。CLI 実行はモックせず、出力 JSON を直接渡す。
import { describe, it, expect } from 'vitest';
import { parseTailscaleFqdn } from './tailscale.mjs';

describe('parseTailscaleFqdn', () => {
  it('末尾ドット付き FQDN からドットを 1 つ剥がして返す', () => {
    const json = JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'wsl40.tail123.ts.net.' } });
    expect(parseTailscaleFqdn(json)).toBe('wsl40.tail123.ts.net');
  });

  it('末尾ドットが無い FQDN はそのまま返す', () => {
    const json = JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'host.tail.ts.net' } });
    expect(parseTailscaleFqdn(json)).toBe('host.tail.ts.net');
  });

  it('剥がすのは末尾ドット 1 つだけ（連続ドットは 1 つ残す）', () => {
    const json = JSON.stringify({ Self: { DNSName: 'a.b.ts.net..' } });
    expect(parseTailscaleFqdn(json)).toBe('a.b.ts.net.');
  });

  it('BackendState が Running でなければ throw', () => {
    const json = JSON.stringify({ BackendState: 'Stopped', Self: { DNSName: 'x.ts.net.' } });
    expect(() => parseTailscaleFqdn(json)).toThrow(/BackendState|起動/);
  });

  it('DNSName が空なら throw', () => {
    const json = JSON.stringify({ BackendState: 'Running', Self: {} });
    expect(() => parseTailscaleFqdn(json)).toThrow(/DNSName/);
  });

  it('JSON が不正なら throw', () => {
    expect(() => parseTailscaleFqdn('not json')).toThrow(/パース/);
  });

  it('BackendState 欠如でも DNSName があれば返す（後方互換）', () => {
    const json = JSON.stringify({ Self: { DNSName: 'only.ts.net.' } });
    expect(parseTailscaleFqdn(json)).toBe('only.ts.net');
  });
});
