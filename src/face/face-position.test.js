import { describe, it, expect } from 'vitest';
import { facePositionFromLandmarks } from './face-position';

// MediaPipe FaceLandmarker のランドマーク配列を模した最小データ。
// 鼻先(index 1)の x/y が本関数の入力。他の点は無視される。
function landmarksWithNoseX(x) {
  return landmarksWithNose(x, 0.5);
}
function landmarksWithNose(x, y) {
  const arr = [];
  for (let i = 0; i < 5; i++) arr.push({ x: 0.5, y: 0.5, z: 0 });
  arr[1] = { x, y, z: 0 };
  return arr;
}

describe('facePositionFromLandmarks', () => {
  it('鼻が中央(0.5)なら x は 0', () => {
    // Arrange
    const lm = landmarksWithNoseX(0.5);

    // Act
    const pos = facePositionFromLandmarks(lm);

    // Assert
    expect(pos.x).toBeCloseTo(0, 5);
  });

  it('鼻が右端(maxShift ぶん)なら x は +1 に張り付く', () => {
    // Arrange: 既定 maxShift=0.25 → 0.5+0.25=0.75 で +1
    const lm = landmarksWithNoseX(0.75);

    // Act
    const pos = facePositionFromLandmarks(lm);

    // Assert
    expect(pos.x).toBeCloseTo(1, 5);
  });

  it('鼻が左端なら x は -1 に張り付く', () => {
    // Arrange
    const lm = landmarksWithNoseX(0.25);

    // Act
    const pos = facePositionFromLandmarks(lm);

    // Assert
    expect(pos.x).toBeCloseTo(-1, 5);
  });

  it('clamp: maxShift を超えても ±1 を超えない', () => {
    expect(facePositionFromLandmarks(landmarksWithNoseX(1.0)).x).toBe(1);
    expect(facePositionFromLandmarks(landmarksWithNoseX(0.0)).x).toBe(-1);
  });

  it('invertX で左右が反転する', () => {
    // Arrange
    const lm = landmarksWithNoseX(0.75);

    // Act
    const pos = facePositionFromLandmarks(lm, { invertX: true });

    // Assert
    expect(pos.x).toBeCloseTo(-1, 5);
  });

  it('maxShift を大きくすると感度が下がる', () => {
    // Arrange: maxShift=0.5 なら 0.75 は半分の 0.5 にしかならない
    const lm = landmarksWithNoseX(0.75);

    // Act
    const pos = facePositionFromLandmarks(lm, { maxShift: 0.5 });

    // Assert
    expect(pos.x).toBeCloseTo(0.5, 5);
  });

  it('ランドマークが無い/空なら x は 0', () => {
    expect(facePositionFromLandmarks(undefined).x).toBe(0);
    expect(facePositionFromLandmarks([]).x).toBe(0);
  });

  it('鼻が中央(0.5)なら y は 0', () => {
    expect(facePositionFromLandmarks(landmarksWithNose(0.5, 0.5)).y).toBeCloseTo(0, 5);
  });

  it('鼻が上(maxShiftY ぶん)なら y は -1（画面上方向）', () => {
    // 既定 maxShiftY=0.2 → 0.5-0.2=0.3 で -1（上 = 正規化yが小さい）
    expect(facePositionFromLandmarks(landmarksWithNose(0.5, 0.3)).y).toBeCloseTo(-1, 5);
  });

  it('鼻が下なら y は +1', () => {
    expect(facePositionFromLandmarks(landmarksWithNose(0.5, 0.7)).y).toBeCloseTo(1, 5);
  });

  it('y も ±1 で clamp される', () => {
    expect(facePositionFromLandmarks(landmarksWithNose(0.5, 1.0)).y).toBe(1);
    expect(facePositionFromLandmarks(landmarksWithNose(0.5, 0.0)).y).toBe(-1);
  });

  it('invertY で上下が反転する', () => {
    expect(facePositionFromLandmarks(landmarksWithNose(0.5, 0.3), { invertY: true }).y).toBeCloseTo(1, 5);
  });

  it('ランドマークが無い/空なら y は 0', () => {
    expect(facePositionFromLandmarks(undefined).y).toBe(0);
    expect(facePositionFromLandmarks([]).y).toBe(0);
  });
});
