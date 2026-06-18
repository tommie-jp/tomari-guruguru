import { describe, it, expect } from 'vitest';
import { computeStateFrame, createExprState } from './avatar-state';

// camera2-app.jsx の TWEAK_DEFAULTS と同等の最小セット（このモジュールが読む項目だけ）。
function tweaks(over = {}) {
  return {
    mouthGain: 1.3, thHalf: 0.12, thFull: 0.35, release: 0.25,
    blinkSync: true, blinkSensitivity: 1.0, eyesOpenBias: 0,
    tiltEnabled: true, tiltGain: 1.0, tiltMax: 20, invertTilt: false,
    slideEnabled: true, slideGain: 12, slideMax: 30, invertSlide: false,
    slideGainY: 8, slideMaxY: 25, invertSlideY: false, slidePoseComp: 0.6,
    zoomEnabled: true, zoomGain: 1.0, zoomMin: 0.6, zoomMax: 1.8,
    zoomPitchComp: 1.0, zoomBaseline: 0,
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

  it('スライド無効なら slideX/slideY=0', () => {
    const f = computeStateFrame(signals({ posX: 0.5, posY: 0.5 }), tweaks({ slideEnabled: false }), createExprState(), 0);
    expect(f.slideX).toBe(0);
    expect(f.slideY).toBe(0);
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
