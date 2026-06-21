import { describe, it, expect } from 'vitest';
import { computeStateFrame, createExprState } from './avatar-state';

// camera-app.jsx の TWEAK_DEFAULTS と同等の最小セット（このモジュールが読む項目だけ）。
function tweaks(over = {}) {
  return {
    mouthGain: 1.3, thHalf: 0.12, thFull: 0.35, release: 0.25,
    blinkSync: true, blinkSensitivity: 1.0, eyesOpenBias: 0,
    tiltEnabled: true, tiltGain: 1.0, tiltMax: 20, invertTilt: false, tiltYawComp: 0,
    slideEnabled: true, slideGain: 12, slideMax: 30, invertSlide: false,
    slideGainY: 8, slideMaxY: 25, invertSlideY: false, slidePoseCompX: 0.6, slidePoseCompY: 0.6,
    zoomEnabled: true, zoomGain: 1.0, zoomMin: 0.6, zoomMax: 1.8,
    zoomPitchComp: 1.0, zoomMouthComp: 0, zoomBaseline: 0,
    ...over,
  };
}

function signals(over = {}) {
  return {
    x: 0, y: 0, yaw: 0, pitch: 0, roll: 0,
    posX: 0, posY: 0, faceScale: 0.3, mouth: 0, eyesClosed: 0,
    ...over,
  };
}

describe('computeStateFrame', () => {
  it('向き(x/y)をそのまま colX/rowY に渡す', () => {
    const f = computeStateFrame(signals({ x: 0.5, y: -0.3 }), tweaks(), createExprState(), 0);
    expect(f.colX).toBe(0.5);
    expect(f.rowY).toBe(-0.3);
  });

  it('faceScale=0 のときは faceDetected=false', () => {
    const f = computeStateFrame(signals({ faceScale: 0 }), tweaks(), createExprState(), 0);
    expect(f.faceDetected).toBe(false);
  });

  it('口が大きく開くと数フレームで sheet が口開け(段2)へ上がる', () => {
    const expr = createExprState();
    const t = tweaks();
    let f;
    // 60ms デバウンスを越えるよう now を進めつつ、開口を与え続ける
    for (let i = 0; i < 20; i++) {
      f = computeStateFrame(signals({ mouth: 1 }), t, expr, i * 30);
    }
    expect(f.sheet % 3).toBe(2); // 口は全開段
  });

  it('まばたき同調: 目を強く閉じると sheet が目閉じ側(>=3)になる', () => {
    const expr = createExprState();
    const t = tweaks();
    const closed = computeStateFrame(signals({ eyesClosed: 0.9 }), t, expr, 0);
    expect(closed.sheet).toBeGreaterThanOrEqual(3);
    // ヒステリシス: わずかに開いても openTh(=closeTh*0.6) を下回るまで閉じ扱いが続く
    const stillClosed = computeStateFrame(signals({ eyesClosed: 0.4 }), t, expr, 30);
    expect(stillClosed.sheet).toBeGreaterThanOrEqual(3);
    const open = computeStateFrame(signals({ eyesClosed: 0.0 }), t, expr, 60);
    expect(open.sheet).toBeLessThan(3);
  });

  it('blinkSync OFF では blinkOverride で目の開閉が決まる', () => {
    const t = tweaks({ blinkSync: false });
    const closed = computeStateFrame(signals({ eyesClosed: 0 }), t, createExprState(), 0, { blinkOverride: true });
    expect(closed.sheet).toBeGreaterThanOrEqual(3);
    const open = computeStateFrame(signals({ eyesClosed: 1 }), t, createExprState(), 0, { blinkOverride: false });
    expect(open.sheet).toBeLessThan(3);
  });

  it('首かしげ無効なら tilt=0', () => {
    const f = computeStateFrame(signals({ roll: 0.5 }), tweaks({ tiltEnabled: false }), createExprState(), 0);
    expect(f.tilt).toBe(0);
  });

  it('roll が正なら tilt も正・上限でクランプ', () => {
    const f = computeStateFrame(signals({ roll: 5 }), tweaks({ tiltMax: 20 }), createExprState(), 0);
    expect(f.tilt).toBe(20);
  });

  it('かしげバイアス: 今の roll を中立にすると tilt≒0 になる', () => {
    // roll=0.3rad の姿勢を中立として記録（biasRollDeg=今の roll を整数度で）→ 差し引いて ~0。
    // biasRollDeg は整数度なので残差は最大 0.5°程度（本番の Math.round と同じ挙動）。
    const biasRollDeg = Math.round(0.3 / (Math.PI / 180));
    const f = computeStateFrame(signals({ roll: 0.3 }), tweaks({ biasRollDeg }), createExprState(), 0);
    const uncalibrated = computeStateFrame(signals({ roll: 0.3 }), tweaks(), createExprState(), 0);
    expect(Math.abs(f.tilt)).toBeLessThan(1); // 中立化されてほぼ 0
    expect(Math.abs(f.tilt)).toBeLessThan(Math.abs(uncalibrated.tilt)); // 校正なしより小さい
  });

  it('かしげバイアス: 中立からのズレ分だけ tilt が出る', () => {
    // 中立を 0.2rad に置き、今 0.2rad なら ~0、0.5rad なら差分だけかしげる。
    const biasRollDeg = Math.round(0.2 / (Math.PI / 180));
    const t = tweaks({ biasRollDeg, tiltGain: 1.0, tiltMax: 45 });
    const neutral = computeStateFrame(signals({ roll: 0.2 }), t, createExprState(), 0);
    const tilted = computeStateFrame(signals({ roll: 0.5 }), t, createExprState(), 0);
    expect(Math.abs(neutral.tilt)).toBeLessThan(1);
    expect(tilted.tilt).toBeGreaterThan(neutral.tilt + 5);
  });

  it('左右向き補正OFF: 右を向く(yaw>0)と混入 roll でかしげる（症状の再現）', () => {
    const f = computeStateFrame(signals({ roll: 0.12, yaw: 0.4 }), tweaks({ tiltYawComp: 0 }), createExprState(), 0);
    expect(f.tilt).not.toBeCloseTo(0, 2);
  });

  it('左右向き補正ON: yaw 由来のかしげを打ち消して tilt≒0', () => {
    // roll=0.12 は yaw=0.4 由来の混入のみ。comp=0.3 で 0.3*0.4=0.12 を引いて相殺。
    const f = computeStateFrame(signals({ roll: 0.12, yaw: 0.4 }), tweaks({ tiltYawComp: 0.3 }), createExprState(), 0);
    expect(f.tilt).toBeCloseTo(0, 5);
  });

  it('スライド無効なら slideX/slideY=0', () => {
    const f = computeStateFrame(signals({ posX: 0.5, posY: 0.5 }), tweaks({ slideEnabled: false }), createExprState(), 0);
    expect(f.slideX).toBe(0);
    expect(f.slideY).toBe(0);
  });

  it('左右向き補正(slidePoseCompX): 右を向く(yaw>0)と posX に混入したズレを打ち消す', () => {
    // posX=0.2 は yaw=0.4 由来の混入のみ。compX=0.5 で 0.5*0.4=0.2 を引いて slideX≒0。
    const base = { posX: 0.2, posY: 0, yaw: 0.4, invertSlide: false };
    const off = computeStateFrame(signals(base), tweaks({ slidePoseCompX: 0, invertSlide: false }), createExprState(), 0);
    const on = computeStateFrame(signals(base), tweaks({ slidePoseCompX: 0.5, invertSlide: false }), createExprState(), 0);
    expect(Math.abs(off.slideX)).toBeGreaterThan(0);
    expect(on.slideX).toBeCloseTo(0, 5);
  });

  it('左右補正(slidePoseCompX)は上下(slideY)に影響しない＝独立に調整できる', () => {
    const sig = signals({ posX: 0.2, posY: 0.3, yaw: 0.4, pitch: 0 });
    const a = computeStateFrame(sig, tweaks({ slidePoseCompX: 0, invertSlide: false }), createExprState(), 0);
    const b = computeStateFrame(sig, tweaks({ slidePoseCompX: 1.5, invertSlide: false }), createExprState(), 0);
    expect(b.slideX).not.toBeCloseTo(a.slideX, 3); // X は変わる
    expect(b.slideY).toBeCloseTo(a.slideY, 5);     // Y は不変
  });

  it('ズーム: 初回サイズが自動基準になり等倍から始まる', () => {
    const expr = createExprState();
    const f = computeStateFrame(signals({ faceScale: 0.3 }), tweaks(), expr, 0);
    expect(f.zoom).toBeCloseTo(1, 5);
    expect(expr.autoBaseline).toBeGreaterThan(0);
    // 近づいて見かけサイズが増えるとズーム率が上がる
    const closer = computeStateFrame(signals({ faceScale: 0.45 }), tweaks(), expr, 30);
    expect(closer.zoom).toBeGreaterThan(1);
  });

  it('ズーム無効なら zoom=1', () => {
    const f = computeStateFrame(signals({ faceScale: 0.45 }), tweaks({ zoomEnabled: false }), createExprState(), 0);
    expect(f.zoom).toBe(1);
  });

  it('口開き補正OFF(zoomMouthComp=0): 口を開くと faceScale 増でズーム率が上がる（症状の再現）', () => {
    const t = tweaks({ zoomBaseline: 0.3, zoomMouthComp: 0 });
    // 口を閉じた基準サイズ0.3 → 口を開いて顎ドロップで0.345に増えた、という想定
    const f = computeStateFrame(signals({ faceScale: 0.345, mouth: 1 }), t, createExprState(), 0);
    expect(f.zoom).toBeGreaterThan(1);
  });

  it('口開き補正ON(zoomMouthComp): 顎ドロップ分を打ち消してズーム率を基準へ戻す', () => {
    // 同条件で comp を上げると、口を開いてもほぼ等倍に戻る（0.345*(1-0.13)≒0.30=基準）。
    const t = tweaks({ zoomBaseline: 0.3, zoomMouthComp: 0.13 });
    const f = computeStateFrame(signals({ faceScale: 0.345, mouth: 1 }), t, createExprState(), 0);
    expect(f.zoom).toBeCloseTo(1, 1);
  });

  it('opts.user をユーザー操作(userX/userY/userZoom)として透過する', () => {
    const f = computeStateFrame(signals(), tweaks(), createExprState(), 0, { user: { x: 12, y: -3, zoom: 1.6 } });
    expect(f.userX).toBe(12);
    expect(f.userY).toBe(-3);
    expect(f.userZoom).toBe(1.6);
  });

  it('opts.user 省略時は移動0・ズーム1', () => {
    const f = computeStateFrame(signals(), tweaks(), createExprState(), 0);
    expect(f.userX).toBe(0);
    expect(f.userY).toBe(0);
    expect(f.userZoom).toBe(1);
  });
});
