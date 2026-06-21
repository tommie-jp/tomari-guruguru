import { describe, it, expect } from 'vitest';
import {
  computeSlidePoseCompX, computeSlidePoseCompY, computeZoomPitchComp, computeTiltYawComp,
} from './calibrate-comp';

describe('computeSlidePoseCompX（左右を向いたときの位置ズレ補正の逆算）', () => {
  it('右を向いて鼻先が右へズレた分を打ち消す comp を返す', () => {
    // posX=0.3, yaw=0.4 → comp=0.3/0.4=0.75
    const c = computeSlidePoseCompX({ posX: 0.3, yaw: 0.4, invertSlide: false });
    expect(c).toBeCloseTo(0.75, 2);
  });

  it('左右反転ON: posX が反転していても符号が合って正の comp になる', () => {
    // invertSlide=true では posX が反転して入る。sign=-1 で相殺し comp は正。
    const c = computeSlidePoseCompX({ posX: -0.3, yaw: 0.4, invertSlide: true });
    expect(c).toBeCloseTo(0.75, 2);
  });

  it('左向き（yaw 負・posX 負）でも正の comp を返す', () => {
    const c = computeSlidePoseCompX({ posX: -0.3, yaw: -0.4, invertSlide: false });
    expect(c).toBeCloseTo(0.75, 2);
  });

  it('ドリフトが逆符号（補正不要/誤計測）なら null', () => {
    expect(computeSlidePoseCompX({ posX: -0.3, yaw: 0.4, invertSlide: false })).toBeNull();
  });

  it('yaw が小さすぎる（振り不足）なら null', () => {
    expect(computeSlidePoseCompX({ posX: 0.1, yaw: 0.02, invertSlide: false })).toBeNull();
  });

  it('非有限入力は null、上限でクランプ', () => {
    expect(computeSlidePoseCompX({ posX: Number.NaN, yaw: 0.4, invertSlide: false })).toBeNull();
    // 巨大なドリフト → maxComp(2) で頭打ち
    const c = computeSlidePoseCompX({ posX: 0.99, yaw: 0.1, invertSlide: false, maxComp: 2 });
    expect(c).toBe(2);
  });
});

describe('computeSlidePoseCompY（上下を向いたときの位置ズレ補正の逆算）', () => {
  it('下を向いて鼻先が下へズレた分を打ち消す comp を返す', () => {
    // avatar-state は normAngle=-pitch を使う。下向き pitch=-0.4 → -pitch=0.4。
    // posY=0.3 → comp=0.3/0.4=0.75
    const c = computeSlidePoseCompY({ posY: 0.3, pitch: -0.4, invertSlideY: false });
    expect(c).toBeCloseTo(0.75, 2);
  });

  it('上下反転ON でも符号が合って正の comp になる', () => {
    const c = computeSlidePoseCompY({ posY: -0.3, pitch: -0.4, invertSlideY: true });
    expect(c).toBeCloseTo(0.75, 2);
  });

  it('上向き（pitch 正・posY 負）でも正の comp を返す', () => {
    // 上向き pitch=0.4 → -pitch=-0.4。上を向くと鼻先が上=posY 負。
    const c = computeSlidePoseCompY({ posY: -0.3, pitch: 0.4, invertSlideY: false });
    expect(c).toBeCloseTo(0.75, 2);
  });

  it('逆符号・振り不足は null', () => {
    expect(computeSlidePoseCompY({ posY: -0.3, pitch: -0.4, invertSlideY: false })).toBeNull();
    expect(computeSlidePoseCompY({ posY: 0.1, pitch: -0.02, invertSlideY: false })).toBeNull();
  });
});

describe('computeTiltYawComp（左右を向いたときのかしげ混入補正の逆算）', () => {
  it('右を向いて混入した roll を打ち消す comp を返す（符号付き）', () => {
    // avatar-state: (roll-biasRoll) - comp*clamp(yaw)=0 → comp=(roll-biasRoll)/yaw
    // roll=0.12, yaw=0.4 → 0.3
    const c = computeTiltYawComp({ roll: 0.12, yaw: 0.4 });
    expect(c).toBeCloseTo(0.3, 2);
  });

  it('かしげ中立バイアスを差し引いてから逆算する', () => {
    // biasRollRad=0.08 を引く: (0.2-0.08)/0.4 = 0.3
    const c = computeTiltYawComp({ roll: 0.2, yaw: 0.4, biasRollRad: 0.08 });
    expect(c).toBeCloseTo(0.3, 2);
  });

  it('逆向きの混入は負の comp（符号付き）', () => {
    const c = computeTiltYawComp({ roll: -0.12, yaw: 0.4 });
    expect(c).toBeCloseTo(-0.3, 2);
  });

  it('±1 でクランプ・yaw 振り不足は null・非有限は null', () => {
    expect(computeTiltYawComp({ roll: 0.6, yaw: 0.1 })).toBe(1); // 6 → 1
    expect(computeTiltYawComp({ roll: 0.12, yaw: 0.02 })).toBeNull();
    expect(computeTiltYawComp({ roll: Number.NaN, yaw: 0.4 })).toBeNull();
  });
});

describe('computeZoomPitchComp（上下を向いたときのズーム変化補正の逆算）', () => {
  it('foreshortening で縮んだ顔サイズを基準へ戻す comp を返す', () => {
    // pitch=0.5 で cos≈0.8776, 1/cos-1≈0.1395。faceScale=0.351, baseline=0.4 → comp≈1.0
    const c = computeZoomPitchComp({ faceScale: 0.351, pitch: 0.5, baseline: 0.4 });
    expect(c).toBeCloseTo(1.0, 1);
  });

  it('上向き（pitch 正）でも下向き（pitch 負）でも対称に効く', () => {
    const up = computeZoomPitchComp({ faceScale: 0.351, pitch: 0.5, baseline: 0.4 });
    const down = computeZoomPitchComp({ faceScale: 0.351, pitch: -0.5, baseline: 0.4 });
    expect(down).toBeCloseTo(up, 5);
  });

  it('縮んでいない（faceScale >= baseline）なら補正不要で null', () => {
    expect(computeZoomPitchComp({ faceScale: 0.42, pitch: 0.5, baseline: 0.4 })).toBeNull();
  });

  it('pitch が小さすぎる・baseline/faceScale が不正なら null', () => {
    expect(computeZoomPitchComp({ faceScale: 0.3, pitch: 0.02, baseline: 0.4 })).toBeNull();
    expect(computeZoomPitchComp({ faceScale: 0.3, pitch: 0.5, baseline: 0 })).toBeNull();
    expect(computeZoomPitchComp({ faceScale: 0, pitch: 0.5, baseline: 0.4 })).toBeNull();
  });
});
