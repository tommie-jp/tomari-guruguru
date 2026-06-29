import { describe, it, expect } from 'vitest';
import {
  MAX_LIVE_PTS,
  sanitizeLivePoint,
  sanitizeLivePoints,
  isRenderablePts,
  clampLiveWidth,
  sanitizeLiveColor,
} from './draw-live';

describe('draw-live ヘルパー', () => {
  describe('sanitizeLivePoint', () => {
    it('整数に丸めた [x,y] を返す', () => {
      expect(sanitizeLivePoint([1.4, 2.6])).toEqual([1, 3]);
      expect(sanitizeLivePoint([-0.4, 0])).toEqual([0, 0]);
    });

    it('非有限・非配列・要素不足は null', () => {
      expect(sanitizeLivePoint([NaN, 0])).toBeNull();
      expect(sanitizeLivePoint([0, Infinity])).toBeNull();
      expect(sanitizeLivePoint([1])).toBeNull();
      expect(sanitizeLivePoint('x')).toBeNull();
      expect(sanitizeLivePoint(null)).toBeNull();
    });

    it('座標が範囲外（異常値/偽注入）は null', () => {
      expect(sanitizeLivePoint([1e9, 0])).toBeNull();
      expect(sanitizeLivePoint([0, -1e9])).toBeNull();
    });
  });

  describe('sanitizeLivePoints', () => {
    it('null 点を捨て、整形した配列を返す', () => {
      expect(sanitizeLivePoints([[0, 0], [NaN, 1], [2.2, 3.7]])).toEqual([[0, 0], [2, 4]]);
    });

    it('MAX_LIVE_PTS で切り詰める（暴走/偽注入防御）', () => {
      const many = Array.from({ length: MAX_LIVE_PTS + 50 }, (_, i) => [i % 1000, i % 1000]);
      expect(sanitizeLivePoints(many).length).toBe(MAX_LIVE_PTS);
    });

    it('配列でなければ空配列', () => {
      expect(sanitizeLivePoints(null)).toEqual([]);
      expect(sanitizeLivePoints(undefined)).toEqual([]);
      expect(sanitizeLivePoints('nope')).toEqual([]);
    });
  });

  describe('isRenderablePts', () => {
    it('2点以上で true（getSmoothPathFromPoints は複数点前提なので1点は描かない）', () => {
      expect(isRenderablePts([[0, 0], [1, 1]])).toBe(true);
      expect(isRenderablePts([[0, 0]])).toBe(false);
      expect(isRenderablePts([])).toBe(false);
      expect(isRenderablePts(null)).toBe(false);
    });
  });

  describe('clampLiveWidth', () => {
    it('1〜64 にクランプ、非数は1', () => {
      expect(clampLiveWidth(6)).toBe(6);
      expect(clampLiveWidth(0)).toBe(1);
      expect(clampLiveWidth(999)).toBe(64);
      expect(clampLiveWidth('x')).toBe(1);
      expect(clampLiveWidth(NaN)).toBe(1);
    });
  });

  describe('sanitizeLiveColor', () => {
    it('#rrggbb のみ受理、それ以外は既定色', () => {
      expect(sanitizeLiveColor('#00ff00')).toBe('#00ff00');
      expect(sanitizeLiveColor('#ABCDEF')).toBe('#ABCDEF');
      expect(sanitizeLiveColor('red')).toBe('#ff3b30');
      expect(sanitizeLiveColor('#fff')).toBe('#ff3b30');
      expect(sanitizeLiveColor(123)).toBe('#ff3b30');
      expect(sanitizeLiveColor(null)).toBe('#ff3b30');
    });

    it('fallback を差し替えられる', () => {
      expect(sanitizeLiveColor('bad', '#000000')).toBe('#000000');
    });
  });
});
