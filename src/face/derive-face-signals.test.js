import { describe, it, expect } from 'vitest';
import { deriveFaceSignals } from './derive-face-signals';

// 列優先(column-major)の単位行列。前方ベクトル(m8,m9,m10)=(0,0,1) なので正面。
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

describe('deriveFaceSignals', () => {
  it('行列が無ければ faceDetected=false で中立を返す（向きは含めない）', () => {
    const s = deriveFaceSignals({});
    expect(s.faceDetected).toBe(false);
    expect(s.x).toBeUndefined();
    expect(s.y).toBeUndefined();
    expect(s.yaw).toBeUndefined();
    expect(s.pitch).toBeUndefined();
    expect(s.roll).toBe(0);
    expect(s.posX).toBe(0);
    expect(s.posY).toBe(0);
    expect(s.faceScale).toBe(0);
    expect(s.mouth).toBe(0);
    expect(s.eyesClosed).toBe(0);
    expect(s.blendshapes).toEqual([]);
  });

  it('result が null/undefined でも安全に faceDetected=false', () => {
    expect(deriveFaceSignals(null).faceDetected).toBe(false);
    expect(deriveFaceSignals(undefined).faceDetected).toBe(false);
  });

  it('行列・ランドマーク・ブレンドシェイプから各信号を組み立てる', () => {
    const categories = [
      { categoryName: 'jawOpen', score: 0.7 },
      { categoryName: 'eyeBlinkLeft', score: 0.2 },
      { categoryName: 'eyeBlinkRight', score: 0.4 },
    ];
    const landmarks = [
      { x: 0.5, y: 0.4 },
      { x: 0.5, y: 0.5 }, // index 1 = 鼻先（中央）
      { x: 0.5, y: 0.6 },
    ];
    const result = {
      facialTransformationMatrixes: [{ data: IDENTITY }],
      faceLandmarks: [landmarks],
      faceBlendshapes: [{ categories }],
    };

    const s = deriveFaceSignals(result);

    expect(s.faceDetected).toBe(true);
    // 正面の単位行列なので向き・傾きは 0
    expect(s.x).toBeCloseTo(0);
    expect(s.y).toBeCloseTo(0);
    expect(s.roll).toBeCloseTo(0);
    // 鼻が中央なのでスライドも 0
    expect(s.posX).toBeCloseTo(0);
    expect(s.posY).toBeCloseTo(0);
    // バウンディングボックス高さ 0.6-0.4
    expect(s.faceScale).toBeCloseTo(0.2);
    expect(s.mouth).toBeCloseTo(0.7);
    expect(s.eyesClosed).toBeCloseTo(0.3); // (0.2+0.4)/2
    expect(s.blendshapes).toBe(categories);
  });

  it('positionOptions を facePosition に橋渡しする（invertX が効く）', () => {
    const landmarks = [{ x: 0, y: 0 }, { x: 0.75, y: 0.5 }]; // 鼻=index1 が右寄り
    const result = {
      facialTransformationMatrixes: [{ data: IDENTITY }],
      faceLandmarks: [landmarks],
      faceBlendshapes: [{ categories: [] }],
    };

    const normal = deriveFaceSignals(result, { positionOptions: { invertX: false } });
    const inverted = deriveFaceSignals(result, { positionOptions: { invertX: true } });

    expect(normal.posX).toBeGreaterThan(0);
    expect(inverted.posX).toBeCloseTo(-normal.posX);
  });
});
