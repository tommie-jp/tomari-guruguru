import { describe, it, expect } from 'vitest';
import { GESTURES, EASES, sampleGesture, gestureTransform } from './gestures.js';

const BASE = { r: 2, c: 2 };
const GRID = { rows: 5, cols: 5 };

describe('EASES', () => {
  it('全イージングは 0→0, 1→1 を満たす', () => {
    for (const fn of Object.values(EASES)) {
      expect(fn(0)).toBeCloseTo(0, 6);
      expect(fn(1)).toBeCloseTo(1, 6);
    }
  });

  it('easeOutBack は途中で 1 を超える（オーバーシュート）', () => {
    expect(EASES.easeOutBack(0.8)).toBeGreaterThan(1);
  });
});

describe('sampleGesture — 共通仕様', () => {
  it('終了後（elapsed >= total）は null を返す', () => {
    expect(sampleGesture(GESTURES.spin, GESTURES.spin.total, BASE, GRID)).toBeNull();
    expect(sampleGesture(GESTURES.nod, 9999, BASE, GRID)).toBeNull();
  });

  it('gesture が無ければ null', () => {
    expect(sampleGesture(null, 0, BASE, GRID)).toBeNull();
    expect(sampleGesture(undefined, 0, BASE, GRID)).toBeNull();
  });

  it('t=0 では先頭キーの値を返す', () => {
    const s = sampleGesture(GESTURES.spin, 0, BASE, GRID);
    expect(s.cell).toEqual({ r: 2, c: 2 });
    expect(s.rotate).toBeCloseTo(0, 6);
    expect(s.scale).toBeCloseTo(1, 6);
  });

  it('セルは常に 0..4 にクランプされる', () => {
    const edge = { r: 4, c: 4 };
    for (const name of Object.keys(GESTURES)) {
      const g = GESTURES[name];
      for (let t = 0; t < g.total; t += 17) {
        const s = sampleGesture(g, t, edge, GRID);
        expect(s.cell.r).toBeGreaterThanOrEqual(0);
        expect(s.cell.r).toBeLessThanOrEqual(4);
        expect(s.cell.c).toBeGreaterThanOrEqual(0);
        expect(s.cell.c).toBeLessThanOrEqual(4);
      }
    }
  });
});

describe('spin（回転）', () => {
  it('全区間 正面 r2c2 に固定される', () => {
    const g = GESTURES.spin;
    for (let t = 0; t < g.total; t += 13) {
      const s = sampleGesture(g, t, { r: 0, c: 0 }, GRID); // base がどこでも正面固定
      expect(s.cell).toEqual({ r: 2, c: 2 });
    }
  });

  it('途中で回転し、終端付近は 360°近傍へ着地する', () => {
    const mid = sampleGesture(GESTURES.spin, 500, BASE, GRID);
    expect(Math.abs(mid.rotate)).toBeGreaterThan(30); // しっかり回っている
    const near = sampleGesture(GESTURES.spin, 979, BASE, GRID);
    expect(near.rotate).toBeGreaterThan(355);
    expect(near.rotate).toBeLessThan(366);
  });
});

describe('nod（うなずき）', () => {
  it('列は base 固定、行だけ動く', () => {
    const g = GESTURES.nod;
    let movedRow = false;
    for (let t = 0; t < g.total; t += 11) {
      const s = sampleGesture(g, t, BASE, GRID);
      expect(s.cell.c).toBe(BASE.c); // 横ブレなし
      if (s.cell.r !== BASE.r) movedRow = true;
    }
    expect(movedRow).toBe(true);
  });

  it('下げる前に一度 base より上（r<base.r）へ行く（上フリック）', () => {
    const up = sampleGesture(GESTURES.nod, 90, BASE, GRID);
    expect(up.cell.r).toBeLessThan(BASE.r);
  });

  it('base からの相対なので、上を向いていても下げる方向へ動く', () => {
    const lookUp = { r: 0, c: 2 };
    const down = sampleGesture(GESTURES.nod, 260, lookUp, GRID);
    expect(down.cell.r).toBeGreaterThan(lookUp.r);
  });
});

describe('shake（No）', () => {
  it('行は base 固定、列だけ左右に振れる', () => {
    const g = GESTURES.shake;
    let leftSeen = false;
    let rightSeen = false;
    for (let t = 0; t < g.total; t += 11) {
      const s = sampleGesture(g, t, BASE, GRID);
      expect(s.cell.r).toBe(BASE.r); // 縦ブレなし
      if (s.cell.c < BASE.c) leftSeen = true;
      if (s.cell.c > BASE.c) rightSeen = true;
    }
    expect(leftSeen).toBe(true);
    expect(rightSeen).toBe(true);
  });
});

// ── おまけジェスチャー ──────────────────────────────────────────────

describe('tilt（傾げる / CSS rotate のみ）', () => {
  it('全区間 cell は base に固定される（向きは変えず傾けるだけ）', () => {
    const g = GESTURES.tilt;
    for (let t = 0; t < g.total; t += 13) {
      const s = sampleGesture(g, t, BASE, GRID);
      expect(s.cell).toEqual(BASE);
    }
  });

  it('途中でしっかり傾き、終端付近で 0° へ戻る', () => {
    const mid = sampleGesture(GESTURES.tilt, 400, BASE, GRID);
    expect(Math.abs(mid.rotate)).toBeGreaterThan(8);
    const near = sampleGesture(GESTURES.tilt, GESTURES.tilt.total - 1, BASE, GRID);
    expect(Math.abs(near.rotate)).toBeLessThan(2);
  });
});

describe('shiver（ぷるぷる / CSS rotate のみ）', () => {
  it('cell は base 固定、rotate は左右（正負）に震える', () => {
    const g = GESTURES.shiver;
    let posSeen = false;
    let negSeen = false;
    for (let t = 0; t < g.total; t += 7) {
      const s = sampleGesture(g, t, BASE, GRID);
      expect(s.cell).toEqual(BASE);
      if (s.rotate > 0.5) posSeen = true;
      if (s.rotate < -0.5) negSeen = true;
    }
    expect(posSeen).toBe(true);
    expect(negSeen).toBe(true);
  });

  it('終端付近で揺れが収まる（rotate ≈ 0）', () => {
    const near = sampleGesture(GESTURES.shiver, GESTURES.shiver.total - 1, BASE, GRID);
    expect(Math.abs(near.rotate)).toBeLessThan(2);
  });
});

describe('lookAround（見回す / フレーム移動）', () => {
  it('CSS 回転はせず（rotate 常に 0）、左右どちらの端も見る', () => {
    const g = GESTURES.lookAround;
    let leftSeen = false;
    let rightSeen = false;
    for (let t = 0; t < g.total; t += 17) {
      const s = sampleGesture(g, t, BASE, GRID);
      expect(s.rotate).toBeCloseTo(0, 6);
      if (s.cell.c < BASE.c) leftSeen = true;
      if (s.cell.c > BASE.c) rightSeen = true;
    }
    expect(leftSeen).toBe(true);
    expect(rightSeen).toBe(true);
  });

  it('終端で base へ戻る', () => {
    const near = sampleGesture(GESTURES.lookAround, GESTURES.lookAround.total - 1, BASE, GRID);
    expect(near.cell).toEqual(BASE);
  });
});

describe('glance（きょろきょろ / フレーム移動）', () => {
  it('rotate 0 のまま、列は左右・行は上下に細かく動く', () => {
    const g = GESTURES.glance;
    let leftSeen = false;
    let rightSeen = false;
    let movedRow = false;
    for (let t = 0; t < g.total; t += 7) {
      const s = sampleGesture(g, t, BASE, GRID);
      expect(s.rotate).toBeCloseTo(0, 6);
      if (s.cell.c < BASE.c) leftSeen = true;
      if (s.cell.c > BASE.c) rightSeen = true;
      if (s.cell.r !== BASE.r) movedRow = true;
    }
    expect(leftSeen).toBe(true);
    expect(rightSeen).toBe(true);
    expect(movedRow).toBe(true);
  });

  it('終端で base へ戻る', () => {
    const near = sampleGesture(GESTURES.glance, GESTURES.glance.total - 1, BASE, GRID);
    expect(near.cell).toEqual(BASE);
  });
});

describe('surprise（びっくり / フレーム＋scale）', () => {
  it('一度 base より上へのけぞる（r < base.r）', () => {
    const g = GESTURES.surprise;
    let recoiled = false;
    for (let t = 0; t < g.total; t += 7) {
      const s = sampleGesture(g, t, BASE, GRID);
      if (s.cell.r < BASE.r) recoiled = true;
    }
    expect(recoiled).toBe(true);
  });

  it('scale が 1 を上回る瞬間（ふくらみ）と下回る瞬間（縮み）が両方ある', () => {
    const g = GESTURES.surprise;
    let grew = false;
    let shrank = false;
    for (let t = 0; t < g.total; t += 7) {
      const s = sampleGesture(g, t, BASE, GRID);
      if (s.scale > 1.02) grew = true;
      if (s.scale < 0.98) shrank = true;
    }
    expect(grew).toBe(true);
    expect(shrank).toBe(true);
  });

  it('終端で base へ戻り、scale ≈ 1 に落ち着く', () => {
    const near = sampleGesture(GESTURES.surprise, GESTURES.surprise.total - 1, BASE, GRID);
    expect(near.cell).toEqual(BASE);
    expect(near.scale).toBeCloseTo(1, 1);
  });
});

describe('gestureTransform', () => {
  it('null は空文字（＝解除）', () => {
    expect(gestureTransform(null)).toBe('');
  });

  it('rotate と scale を含む CSS transform 文字列', () => {
    const s = sampleGesture(GESTURES.spin, 850, BASE, GRID);
    const css = gestureTransform(s);
    expect(css).toMatch(/^rotate\(-?\d+(\.\d+)?deg\) scale\(\d+(\.\d+)?\)$/);
  });
});
