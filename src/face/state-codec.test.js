import { describe, it, expect } from 'vitest';
import { encodeStateFrame, decodeStateFrame } from './state-codec';

describe('state-codec', () => {
  it('encode → JSON → decode で値が（丸め後に）復元される', () => {
    const f = {
      faceDetected: true, colX: 0.4231, rowY: -0.1299, tilt: 12.345,
      slideX: 8.7, slideY: -3.2, zoom: 1.084, sheet: 5,
      userX: 15.5, userY: -7.25, userZoom: 1.4,
    };
    const wire = JSON.stringify(encodeStateFrame(f));
    const back = decodeStateFrame(JSON.parse(wire));
    expect(back.faceDetected).toBe(true);
    expect(back.colX).toBeCloseTo(0.423, 3);
    expect(back.rowY).toBeCloseTo(-0.13, 3);
    expect(back.tilt).toBeCloseTo(12.345, 3);
    expect(back.zoom).toBeCloseTo(1.084, 3);
    expect(back.sheet).toBe(5);
    // ユーザー操作（ドラッグ移動・ズーム）も往復する
    expect(back.userX).toBeCloseTo(15.5, 3);
    expect(back.userY).toBeCloseTo(-7.25, 3);
    expect(back.userZoom).toBeCloseTo(1.4, 3);
  });

  it('faceDetected=false を保つ', () => {
    const back = decodeStateFrame(encodeStateFrame({
      faceDetected: false, colX: 0, rowY: 0, tilt: 0, slideX: 0, slideY: 0, zoom: 1, sheet: 0,
    }));
    expect(back.faceDetected).toBe(false);
  });

  it('配列は固定 11 要素（顔状態8＋ユーザー操作3）', () => {
    const arr = encodeStateFrame({
      faceDetected: true, colX: 0, rowY: 0, tilt: 0, slideX: 0, slideY: 0, zoom: 1, sheet: 0,
      userX: 0, userY: 0, userZoom: 1,
    });
    expect(arr).toHaveLength(11);
  });

  it('旧8要素フレーム（ユーザー操作なし）は既定値で復元される（後方互換）', () => {
    const old = [1, 0, 0, 0, 0, 0, 1, 0]; // userX/Y/Zoom を含まない旧フォーマット
    const back = decodeStateFrame(old);
    expect(back.userX).toBe(0);
    expect(back.userY).toBe(0);
    expect(back.userZoom).toBe(1);
  });

  it('sheet は整数に正規化される', () => {
    const arr = encodeStateFrame({
      faceDetected: true, colX: 0, rowY: 0, tilt: 0, slideX: 0, slideY: 0, zoom: 1, sheet: 3.9,
    });
    expect(arr[7]).toBe(3);
  });
});
