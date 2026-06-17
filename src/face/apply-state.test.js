import { describe, it, expect } from 'vitest';
import { applyState, createSmoothState } from './apply-state';

const frame = (over = {}) => ({
  faceDetected: true, colX: 0, rowY: 0, tilt: 0, slideX: 0, slideY: 0, zoom: 1, sheet: 0,
  ...over,
});

describe('applyState', () => {
  it('向きターゲットへ徐々に近づき、最終的に端のセルへ収束する', () => {
    const sm = createSmoothState();
    const t = { smoothing: 0.5, motionSmoothing: 0.5 };
    let out;
    for (let i = 0; i < 40; i++) out = applyState(frame({ colX: 1, rowY: 1 }), t, sm);
    // colX=rowY=1 → 右下端（c=4, r=4）
    expect(out.cell).toEqual({ r: 4, c: 4 });
  });

  it('正面(colX=rowY=0)は中央セル(2,2)', () => {
    const sm = createSmoothState();
    const out = applyState(frame(), { smoothing: 1, motionSmoothing: 1 }, sm);
    expect(out.cell).toEqual({ r: 2, c: 2 });
  });

  it('sheet はそのまま透過する', () => {
    const out = applyState(frame({ sheet: 5 }), { smoothing: 1, motionSmoothing: 1 }, createSmoothState());
    expect(out.sheet).toBe(5);
  });

  it('transform 文字列を既存フォーマットで返す', () => {
    const sm = createSmoothState();
    const out = applyState(frame({ slideX: 10, slideY: -5, tilt: 12, zoom: 1.5 }), { smoothing: 1, motionSmoothing: 1 }, sm);
    expect(out.motionTransform).toBe('translateX(10.00vw) translateY(-5.00vh) rotate(12.00deg)');
    expect(out.zoomTransform).toBe('scale(1.500)');
  });

  it('motionSmoothing=1 なら1フレームでターゲットに達する', () => {
    const sm = createSmoothState();
    applyState(frame({ tilt: 20 }), { smoothing: 1, motionSmoothing: 1 }, sm);
    expect(sm.tilt).toBe(20);
  });
});
