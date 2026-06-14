import { describe, it, expect } from 'vitest';
import { faceScaleFromLandmarks } from './face-scale';

// 縦に min..max の範囲で点を散らしたランドマーク群を作る。
// 本関数はバウンディングボックスの高さ(maxY-minY)を「見かけサイズ」とする。
function landmarksSpanningY(minY, maxY) {
  return [
    { x: 0.5, y: minY },
    { x: 0.5, y: (minY + maxY) / 2 },
    { x: 0.5, y: maxY },
  ];
}

describe('faceScaleFromLandmarks', () => {
  it('バウンディングボックスの高さを返す', () => {
    // Arrange: 0.3..0.7 → 高さ 0.4
    const lm = landmarksSpanningY(0.3, 0.7);

    // Act
    const size = faceScaleFromLandmarks(lm);

    // Assert
    expect(size).toBeCloseTo(0.4, 5);
  });

  it('カメラに近い（顔が大きく写る）ほどサイズが大きい', () => {
    const near = faceScaleFromLandmarks(landmarksSpanningY(0.2, 0.8)); // 0.6
    const far = faceScaleFromLandmarks(landmarksSpanningY(0.4, 0.6)); // 0.2

    expect(near).toBeGreaterThan(far);
  });

  it('ランドマークが無い/空なら 0', () => {
    expect(faceScaleFromLandmarks(undefined)).toBe(0);
    expect(faceScaleFromLandmarks([])).toBe(0);
  });

  it('y を持たない点は無視する（壊れた入力に強い）', () => {
    const lm = [{ x: 0.5 }, { x: 0.5, y: 0.3 }, { x: 0.5, y: 0.7 }];
    expect(faceScaleFromLandmarks(lm)).toBeCloseTo(0.4, 5);
  });
});
