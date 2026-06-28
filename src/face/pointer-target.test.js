import { describe, it, expect } from 'vitest';
import { pointerToTarget } from './pointer-target';

// 200x200 の矩形を原点(0,0)に置く。中心 cx=100、cy=top+height*0.45=90。
const RECT = { left: 0, top: 0, width: 200, height: 200 };

describe('pointerToTarget（ポインタ → 向きターゲット -1..1）', () => {
  it('中心(cx,cy)では {0,0}', () => {
    expect(pointerToTarget(100, 90, RECT, 340)).toEqual({ x: 0, y: 0 });
  });

  it('中心から +range で x=1 / y=1（ちょうど端）', () => {
    expect(pointerToTarget(100 + 340, 90, RECT, 340).x).toBeCloseTo(1, 6);
    expect(pointerToTarget(100, 90 + 340, RECT, 340).y).toBeCloseTo(1, 6);
  });

  it('中心から -range で x=-1 / y=-1', () => {
    expect(pointerToTarget(100 - 340, 90, RECT, 340).x).toBeCloseTo(-1, 6);
    expect(pointerToTarget(100, 90 - 340, RECT, 340).y).toBeCloseTo(-1, 6);
  });

  it('range を超えても ±1 にクランプ', () => {
    expect(pointerToTarget(100 + 9999, 90, RECT, 340).x).toBe(1);
    expect(pointerToTarget(100, 90 - 9999, RECT, 340).y).toBe(-1);
  });

  it('range の半分で 0.5（線形）', () => {
    expect(pointerToTarget(100 + 170, 90, RECT, 340).x).toBeCloseTo(0.5, 6);
  });

  it('cy は height*0.45（中心より上）で正規化する', () => {
    // clientY=top(0) は中心(90)より上 → 負。(0-90)/340 ≈ -0.2647。
    expect(pointerToTarget(100, 0, RECT, 340).y).toBeCloseTo(-90 / 340, 6);
  });

  it('invertX / invertY で符号反転', () => {
    const r = pointerToTarget(100 + 170, 90 + 170, RECT, 340, { invertX: true, invertY: true });
    expect(r.x).toBeCloseTo(-0.5, 6);
    expect(r.y).toBeCloseTo(-0.5, 6);
  });
});
