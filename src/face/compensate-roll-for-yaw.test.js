import { describe, it, expect } from 'vitest';
import { compensateRollForYaw, rollYawPitchBasis } from './compensate-roll-for-yaw';

describe('rollYawPitchBasis（yaw×pitch 由来の見かけかしげの基底）', () => {
  it('pitch=0 では yaw によらず 0（純ヨーでは roll 混入しない）', () => {
    expect(rollYawPitchBasis(0.6, 0)).toBeCloseTo(0, 6);
    expect(rollYawPitchBasis(-0.6, 0)).toBeCloseTo(0, 6);
  });

  it('yaw=0 でも 0（正面なら混入なし）', () => {
    expect(rollYawPitchBasis(0, 0.3)).toBeCloseTo(0, 6);
  });

  it('atan2(sin(pitch)·sin(yaw), cos(yaw)) に一致する', () => {
    const y = 0.5;
    const p = 0.3;
    const expected = Math.atan2(Math.sin(p) * Math.sin(y), Math.cos(y));
    expect(rollYawPitchBasis(y, p)).toBeCloseTo(expected, 6);
  });

  it('yaw の奇関数（左右対称）', () => {
    expect(rollYawPitchBasis(-0.5, 0.3)).toBeCloseTo(-rollYawPitchBasis(0.5, 0.3), 6);
  });
});

describe('compensateRollForYaw（pitch を考慮して yaw×pitch 由来のかしげを差し引く）', () => {
  it('comp=0（既定）なら無補正で素通し', () => {
    expect(compensateRollForYaw(0.1, 0.4, 0, 0.3)).toBeCloseTo(0.1, 5);
    expect(compensateRollForYaw(0.1, 0.4)).toBeCloseTo(0.1, 5);
  });

  it('pitch=0 なら混入が無いので comp に関係なく素通し（純ヨーで傾けない）', () => {
    expect(compensateRollForYaw(0.1, 0.4, 0.5, 0)).toBeCloseTo(0.1, 5);
  });

  it('正面(yaw=0)なら roll をそのまま返す', () => {
    expect(compensateRollForYaw(0.1, 0, 0.5, 0.3)).toBeCloseTo(0.1, 5);
  });

  it('混入した roll を comp×基底 で打ち消す（comp=1 で完全相殺）', () => {
    const y = 0.4;
    const p = 0.3;
    const basis = Math.atan2(Math.sin(p) * Math.sin(y), Math.cos(y));
    expect(compensateRollForYaw(basis, y, 1, p)).toBeCloseTo(0, 6);
  });

  it('左右で対称に補正する（yaw の符号に追従）', () => {
    const right = compensateRollForYaw(0, 0.4, 0.5, 0.3);
    const left = compensateRollForYaw(0, -0.4, 0.5, 0.3);
    expect(right).toBeCloseTo(-left, 6);
  });

  it('comp は負も取れる（混入の向きが逆なら符号で合わせる）', () => {
    const pos = compensateRollForYaw(0, 0.4, 0.5, 0.3);
    const neg = compensateRollForYaw(0, 0.4, -0.5, 0.3);
    expect(neg).toBeCloseTo(-pos, 6);
  });

  it('yaw/pitch は maxAngleRad でクランプ（暴発防止）', () => {
    const at = compensateRollForYaw(0, 1.4, 0.5, 0.3);
    const beyond = compensateRollForYaw(0, 2.5, 0.5, 0.3); // 1.4 にクランプ
    expect(beyond).toBeCloseTo(at, 6);
  });

  it('roll が不正値なら0（顔ロスト等）', () => {
    expect(compensateRollForYaw(NaN, 0.4, 0.5, 0.3)).toBe(0);
    expect(compensateRollForYaw(Infinity, 0.4, 0.5, 0.3)).toBe(0);
  });

  it('yaw/pitch が不正値なら roll を素通し', () => {
    expect(compensateRollForYaw(0.1, NaN, 0.5, 0.3)).toBeCloseTo(0.1, 5);
    expect(compensateRollForYaw(0.1, 0.4, 0.5, NaN)).toBeCloseTo(0.1, 5);
  });
});
