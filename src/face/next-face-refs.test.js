import { describe, it, expect } from 'vitest';
import { nextFaceRefs } from './next-face-refs';

// 直前の向き状態（ロスト時の据え置き元）。
const PREV = { target: { x: 0.4, y: -0.2 }, pose: { yaw: 0.3, pitch: -0.1 } };

// 顔検出時の signals（deriveFaceSignals の戻り相当）。
const DETECTED = {
  faceDetected: true,
  x: -0.5, y: 0.6, yaw: -0.7, pitch: 0.2,
  roll: 0.15, posX: 0.1, posY: -0.3, faceScale: 0.42,
  mouth: 0.8, eyesClosed: 0.9,
  blendshapes: [{ categoryName: 'jawOpen', score: 0.8 }],
};

// 顔ロスト時の signals（向きは含まれず、他は中立 0/[]）。
const LOST = {
  faceDetected: false,
  roll: 0, posX: 0, posY: 0, faceScale: 0,
  mouth: 0, eyesClosed: 0, blendshapes: [],
};

describe('nextFaceRefs', () => {
  it('顔検出時は向きも含め signals の値をそのまま採用する', () => {
    // Act
    const next = nextFaceRefs(PREV, DETECTED);

    // Assert
    expect(next.faceDetected).toBe(true);
    expect(next.target).toEqual({ x: -0.5, y: 0.6 });
    expect(next.pose).toEqual({ yaw: -0.7, pitch: 0.2 });
    expect(next.roll).toBe(0.15);
    expect(next.posX).toBe(0.1);
    expect(next.posY).toBe(-0.3);
    expect(next.faceScale).toBe(0.42);
    expect(next.mouth).toBe(0.8);
    expect(next.eyesClosed).toBe(0.9);
    expect(next.blendshapes).toEqual([{ categoryName: 'jawOpen', score: 0.8 }]);
  });

  it('顔ロスト時は向き(target/pose)を直前のまま据え置く', () => {
    // Act
    const next = nextFaceRefs(PREV, LOST);

    // Assert
    expect(next.faceDetected).toBe(false);
    expect(next.target).toEqual({ x: 0.4, y: -0.2 }); // PREV のまま
    expect(next.pose).toEqual({ yaw: 0.3, pitch: -0.1 }); // PREV のまま
  });

  it('顔ロスト時は向き以外(roll/pos/scale/mouth/eyes/blendshapes)を中立へ戻す', () => {
    // Act
    const next = nextFaceRefs(PREV, LOST);

    // Assert
    expect(next.roll).toBe(0);
    expect(next.posX).toBe(0);
    expect(next.posY).toBe(0);
    expect(next.faceScale).toBe(0);
    expect(next.mouth).toBe(0);
    expect(next.eyesClosed).toBe(0);
    expect(next.blendshapes).toEqual([]);
  });

  it('prev を破壊せず、新しいオブジェクトを返す（不変性）', () => {
    // Act
    const next = nextFaceRefs(PREV, DETECTED);

    // Assert: prev は変わらない
    expect(PREV.target).toEqual({ x: 0.4, y: -0.2 });
    expect(PREV.pose).toEqual({ yaw: 0.3, pitch: -0.1 });
    // 別オブジェクト（参照が異なる）
    expect(next.target).not.toBe(PREV.target);
    expect(next.pose).not.toBe(PREV.pose);
  });
});
