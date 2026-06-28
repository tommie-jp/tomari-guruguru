import { describe, it, expect } from 'vitest';
import { composeSignals } from './compose-signals';

// 顔由来の「実値」一式。マウス/マイク時は中立化されることを確認する基準。
const FACE_REFS = {
  target: { x: 0.5, y: -0.3 },
  pose: { yaw: 0.4, pitch: -0.2 },
  roll: 0.1,
  posX: 0.2,
  posY: -0.1,
  faceScale: 0.39,
  mouth: 0.7,
  eyesClosed: 0.8,
};

describe('composeSignals（入力ソース合成）', () => {
  it('向き=顔 / 口=カメラ: すべて実値を素通し', () => {
    const s = composeSignals(FACE_REFS, { direction: 'face', mouthSource: 'camera', micGain: 1.5, micLevel: 0 });
    expect(s).toEqual({
      x: 0.5, y: -0.3, yaw: 0.4, pitch: -0.2, roll: 0.1,
      posX: 0.2, posY: -0.1, faceScale: 0.39, mouth: 0.7, eyesClosed: 0.8,
    });
  });

  it('向き=マウス: x/y は残すが pose/roll/pos/faceScale は中立(0)', () => {
    const s = composeSignals(FACE_REFS, { direction: 'mouse', mouthSource: 'mic', micGain: 1.5, micLevel: 0.1 });
    expect(s.x).toBe(0.5);
    expect(s.y).toBe(-0.3);
    expect(s.yaw).toBe(0);
    expect(s.pitch).toBe(0);
    expect(s.roll).toBe(0);
    expect(s.posX).toBe(0);
    expect(s.posY).toBe(0);
    expect(s.faceScale).toBe(0);
  });

  it('口=mic: 生 RMS × micGain（二重エンベロープしない）', () => {
    const s = composeSignals(FACE_REFS, { direction: 'mouse', mouthSource: 'mic', micGain: 1.5, micLevel: 0.1 });
    expect(s.mouth).toBeCloseTo(0.15, 6);
    expect(s.eyesClosed).toBe(0); // mic では実まばたき無し → 自動まばたきに委譲
  });

  it('口=none: 口とじ(0) かつ目も 0', () => {
    const s = composeSignals(FACE_REFS, { direction: 'mouse', mouthSource: 'none', micGain: 1.5, micLevel: 0.9 });
    expect(s.mouth).toBe(0);
    expect(s.eyesClosed).toBe(0);
  });

  it('ハイブリッド 向き=マウス / 口=カメラ: 口・目はカメラ実値、pose は中立', () => {
    const s = composeSignals(FACE_REFS, { direction: 'mouse', mouthSource: 'camera', micGain: 1.5, micLevel: 0 });
    expect(s.mouth).toBe(0.7);       // 顎はカメラ由来
    expect(s.eyesClosed).toBe(0.8);  // 実まばたきもカメラ由来
    expect(s.yaw).toBe(0);           // ただし頭の向きは体に混ぜない
    expect(s.faceScale).toBe(0);
    expect(s.x).toBe(0.5);           // 体はカーソル追従
  });
});
