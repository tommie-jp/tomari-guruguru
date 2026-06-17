import { describe, it, expect } from 'vitest';
import { computeStateFrame, createExprState } from './avatar-state';
import { applyState, createSmoothState } from './apply-state';
import { encodeStateFrame, decodeStateFrame } from './state-codec';

// producer 側の signals → 状態フレーム → (JSON 経由) → consumer 側の描画状態、という
// docs-camera/05 の全データ経路を1本で検証する（WS は server の smoke で別途確認済み）。
function tweaks(over = {}) {
  return {
    smoothing: 1, motionSmoothing: 1, // 1フレームで収束させ判定を簡単に
    mouthGain: 1.3, thHalf: 0.12, thFull: 0.35, release: 0.25,
    blinkSync: true, blinkSensitivity: 1.0, eyesOpenBias: 0,
    tiltEnabled: true, tiltGain: 1.0, tiltMax: 20, invertTilt: false,
    slideEnabled: true, slideGain: 12, slideMax: 30, invertSlide: false,
    slideGainY: 8, slideMaxY: 25, invertSlideY: false, slidePoseComp: 0.6,
    zoomEnabled: false, zoomGain: 1, zoomMin: 0.6, zoomMax: 1.8, zoomPitchComp: 1, zoomBaseline: 0,
    ...over,
  };
}

// 配線をまたいで1フレーム流す: signals → compute → encode → JSON → decode → apply。
function pipe(signals, t, expr, sm, now) {
  const frame = computeStateFrame(signals, t, expr, now, {});
  const wire = JSON.stringify(encodeStateFrame(frame));
  return applyState(decodeStateFrame(JSON.parse(wire)), t, sm);
}

describe('tx→(wire)→rx パイプライン', () => {
  it('右下向き・口全開・目閉じ → 受信側で右下端セル・シートF(5)', () => {
    const t = tweaks();
    const expr = createExprState();
    const sm = createSmoothState();
    let out;
    const s = { x: 1, y: 1, yaw: 0, pitch: 0, roll: 0, posX: 0, posY: 0, faceScale: 0.3, mouth: 1, eyesClosed: 0.95 };
    for (let i = 0; i < 20; i++) out = pipe(s, t, expr, sm, i * 30);
    expect(out.cell).toEqual({ r: 4, c: 4 });
    expect(out.sheet).toBe(5); // F = 目閉じ×口開け
  });

  it('正面・無表情 → 中央セル・シートA(0)', () => {
    const t = tweaks();
    const out = pipe(
      { x: 0, y: 0, yaw: 0, pitch: 0, roll: 0, posX: 0, posY: 0, faceScale: 0.3, mouth: 0, eyesClosed: 0 },
      t, createExprState(), createSmoothState(), 0,
    );
    expect(out.cell).toEqual({ r: 2, c: 2 });
    expect(out.sheet).toBe(0);
  });

  it('首かしげ(roll>0)が受信側の transform に乗る', () => {
    const t = tweaks();
    const out = pipe(
      { x: 0, y: 0, yaw: 0, pitch: 0, roll: 5, posX: 0, posY: 0, faceScale: 0.3, mouth: 0, eyesClosed: 0 },
      t, createExprState(), createSmoothState(), 0,
    );
    // roll=5rad は tiltMax=20deg にクランプされる
    expect(out.motionTransform).toContain('rotate(20.00deg)');
  });
});
