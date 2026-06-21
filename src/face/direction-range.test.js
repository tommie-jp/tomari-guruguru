import { describe, it, expect } from 'vitest';
import { computeDirectionRange } from './direction-range';

const DEG = Math.PI / 180;

// 共通の入力。dir / sensitivity / bias を上書きしてテストする。
function input(over = {}) {
  return {
    yawRad: 0, pitchRad: 0, biasYawDeg: 0, biasPitchDeg: 0,
    dir: 'right', sensitivity: 1, minDeg: 5,
    ...over,
  };
}

describe('computeDirectionRange', () => {
  it('右に振り切った姿勢から右レンジ(°)を算出する', () => {
    const r = computeDirectionRange(input({ yawRad: 20 * DEG, dir: 'right' }));
    expect(r).toEqual({ key: 'rangeYawRightDeg', deg: 20 });
  });

  it('左は yaw 負側で測り、左レンジへ書く', () => {
    const r = computeDirectionRange(input({ yawRad: -25 * DEG, dir: 'left' }));
    expect(r).toEqual({ key: 'rangeYawLeftDeg', deg: 25 });
  });

  it('上は pitch 正側で測り、上レンジへ書く', () => {
    const r = computeDirectionRange(input({ pitchRad: 15 * DEG, dir: 'up' }));
    expect(r).toEqual({ key: 'rangePitchUpDeg', deg: 15 });
  });

  it('下は pitch 負側で測り、下レンジへ書く', () => {
    const r = computeDirectionRange(input({ pitchRad: -18 * DEG, dir: 'down' }));
    expect(r).toEqual({ key: 'rangePitchDownDeg', deg: 18 });
  });

  it('感度を織り込む（sens=1.5 で 1.5 倍の値を記録 → 振り切り＝端が一致）', () => {
    const r = computeDirectionRange(input({ yawRad: 20 * DEG, sensitivity: 1.5 }));
    expect(r.deg).toBe(30);
  });

  it('中立バイアスを基準に振り角を測る（bias 右10°・姿勢 右30° → 振り20°）', () => {
    const r = computeDirectionRange(input({ yawRad: 30 * DEG, biasYawDeg: 10, dir: 'right' }));
    expect(r.deg).toBe(20);
  });

  it('逆向き（右ボタンなのに左を向く）は null', () => {
    expect(computeDirectionRange(input({ yawRad: -20 * DEG, dir: 'right' }))).toBeNull();
  });

  it('振り不足（minDeg 未満）は null', () => {
    expect(computeDirectionRange(input({ yawRad: 3 * DEG, dir: 'right', minDeg: 5 }))).toBeNull();
  });

  it('不正な方向・感度・非有限は null', () => {
    expect(computeDirectionRange(input({ yawRad: 20 * DEG, dir: 'sideways' }))).toBeNull();
    expect(computeDirectionRange(input({ yawRad: 20 * DEG, sensitivity: 0 }))).toBeNull();
    expect(computeDirectionRange(input({ yawRad: Number.NaN, dir: 'right' }))).toBeNull();
  });
});
