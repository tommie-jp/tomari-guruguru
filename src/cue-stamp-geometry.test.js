import { describe, it, expect } from 'vitest';
import {
  OVER_SIZE,
  ABOVE_SIZE,
  HEAD_CENTER_Y,
  stampFontSize,
  computeStampBox,
} from './cue-stamp-geometry.js';

// アバター矩形（getBoundingClientRect 相当）。検証しやすい丸い値にする。
const RECT = { left: 100, top: 50, width: 200, height: 200 };

describe('stampFontSize', () => {
  it('over はアバター幅 × OVER_SIZE', () => {
    expect(stampFontSize(200, 'over')).toBeCloseTo(200 * OVER_SIZE); // 68
  });
  it('above はアバター幅 × ABOVE_SIZE', () => {
    expect(stampFontSize(200, 'above')).toBeCloseTo(200 * ABOVE_SIZE); // 34
  });
  it('未知の place は over 扱い', () => {
    expect(stampFontSize(200, undefined)).toBeCloseTo(200 * OVER_SIZE);
  });
});

describe('computeStampBox', () => {
  it("over: オフセット無しは従来式（cx / 頭中心）どおり", () => {
    const box = computeStampBox(RECT, { place: 'over' });
    expect(box.fontSize).toBeCloseTo(68);            // 200 * 0.34
    expect(box.left).toBeCloseTo(200);               // left+width/2 = 100+100
    expect(box.top).toBeCloseTo(50 + 200 * HEAD_CENTER_Y - 68 / 2); // 76
  });

  it("above: オフセット無しは下端がアバター上端に来る", () => {
    const box = computeStampBox(RECT, { place: 'above' });
    expect(box.fontSize).toBeCloseTo(34);            // 200 * 0.17
    expect(box.left).toBeCloseTo(200);
    expect(box.top).toBeCloseTo(50 - 34);            // top - fontSize = 16
  });

  it('ox=oy=0 は opts 省略時と完全一致（既存表示を変えない保証）', () => {
    const base = computeStampBox(RECT, { place: 'over' });
    const zero = computeStampBox(RECT, { place: 'over', ox: 0, oy: 0 });
    expect(zero).toEqual(base);
  });

  it('ox/oy は fontSize 倍だけ left/top をずらす（em 単位）', () => {
    const box = computeStampBox(RECT, { place: 'over', ox: 0.5, oy: -0.25 });
    expect(box.left).toBeCloseTo(200 + 0.5 * 68);    // 234
    expect(box.top).toBeCloseTo(76 + -0.25 * 68);    // 59
  });

  it('jit と ox は加算されて左右にずれる', () => {
    const box = computeStampBox(RECT, { place: 'over', jit: 0.1, ox: 0.2 });
    expect(box.left).toBeCloseTo(200 + 0.3 * 68);    // 220.4
  });

  it('opts 省略でも over 既定で落ちない', () => {
    const box = computeStampBox(RECT);
    expect(box.fontSize).toBeCloseTo(68);
    expect(box.left).toBeCloseTo(200);
  });
});
