import { describe, it, expect, vi } from 'vitest';
import { isValidThemeColor, applyThemeColor } from './theme-color.js';

describe('isValidThemeColor', () => {
  it('通常の色文字列は true', () => {
    expect(isValidThemeColor('#EEF4FB')).toBe(true);
    expect(isValidThemeColor('rgb(0,0,0)')).toBe(true);
  });

  it('transparent は false（OBS オーバーレイ等の無効値）', () => {
    expect(isValidThemeColor('transparent')).toBe(false);
    expect(isValidThemeColor(' TRANSPARENT ')).toBe(false);
  });

  it('空文字・非文字列は false', () => {
    expect(isValidThemeColor('')).toBe(false);
    expect(isValidThemeColor('   ')).toBe(false);
    expect(isValidThemeColor(null)).toBe(false);
    expect(isValidThemeColor(undefined)).toBe(false);
    expect(isValidThemeColor(123)).toBe(false);
  });
});

describe('applyThemeColor', () => {
  // jsdom 非導入のため、querySelector/createElement/head を持つプレーンモックを使う。
  function makeDoc({ existing = null } = {}) {
    const meta = existing || { setAttribute: vi.fn() };
    const created = { setAttribute: vi.fn() };
    return {
      _meta: meta,
      _created: created,
      head: { appendChild: vi.fn() },
      querySelector: vi.fn(() => existing),
      createElement: vi.fn(() => created),
    };
  }

  it('既存の meta があれば content を更新する', () => {
    const existing = { setAttribute: vi.fn() };
    const doc = makeDoc({ existing });
    const ok = applyThemeColor('#11140F', doc);
    expect(ok).toBe(true);
    expect(existing.setAttribute).toHaveBeenCalledWith('content', '#11140F');
    expect(doc.createElement).not.toHaveBeenCalled();
  });

  it('meta が無ければ作って head に追加する', () => {
    const doc = makeDoc({ existing: null });
    const ok = applyThemeColor('#FFF8EE', doc);
    expect(ok).toBe(true);
    expect(doc.createElement).toHaveBeenCalledWith('meta');
    expect(doc._created.setAttribute).toHaveBeenCalledWith('name', 'theme-color');
    expect(doc._created.setAttribute).toHaveBeenCalledWith('content', '#FFF8EE');
    expect(doc.head.appendChild).toHaveBeenCalledWith(doc._created);
  });

  it('無効値（transparent/空）は何もせず false', () => {
    const doc = makeDoc({ existing: { setAttribute: vi.fn() } });
    expect(applyThemeColor('transparent', doc)).toBe(false);
    expect(applyThemeColor('', doc)).toBe(false);
    expect(doc.querySelector).not.toHaveBeenCalled();
  });
});
