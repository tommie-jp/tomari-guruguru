import { describe, it, expect } from 'vitest';
import { hintForErrorName } from './camera-diagnostics';

describe('hintForErrorName', () => {
  it('NotAllowedError は「拒否」のヒント', () => {
    expect(hintForErrorName('NotAllowedError')).toContain('拒否');
  });

  it('NotReadableError は「使用中（占有）」のヒント', () => {
    expect(hintForErrorName('NotReadableError')).toContain('使用中');
  });

  it('NotFoundError は「見つかりません」のヒント', () => {
    expect(hintForErrorName('NotFoundError')).toContain('見つかりません');
  });

  it('未知の名前でも空でない文字列を返す', () => {
    const s = hintForErrorName('Whatever');
    expect(typeof s).toBe('string');
    expect(s.length).toBeGreaterThan(0);
  });
});
