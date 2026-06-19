import { describe, it, expect } from 'vitest';
import { compensateRollForYaw } from './compensate-roll-for-yaw';

describe('compensateRollForYaw', () => {
  it('comp=0（既定）なら無補正で素通し', () => {
    expect(compensateRollForYaw(0.1, 0.4)).toBeCloseTo(0.1, 5);
    expect(compensateRollForYaw(0.1, 0.4, 0)).toBeCloseTo(0.1, 5);
  });

  it('正面(yaw=0)なら comp によらず roll をそのまま返す', () => {
    expect(compensateRollForYaw(0.1, 0, 0.5)).toBeCloseTo(0.1, 5);
  });

  it('右を向く(yaw>0)と混入した roll を差し引く', () => {
    // roll に yaw 由来の +0.12 が混じっている想定。comp=0.3 で 0.3*0.4=0.12 を引いて打ち消す。
    const out = compensateRollForYaw(0.12, 0.4, 0.3);
    expect(out).toBeCloseTo(0, 5);
  });

  it('左右で対称に補正する（yaw の符号に追従）', () => {
    const right = compensateRollForYaw(0, 0.4, 0.3);  // -0.12
    const left = compensateRollForYaw(0, -0.4, 0.3);  // +0.12
    expect(right).toBeCloseTo(-left, 5);
  });

  it('comp は負も取れる（混入の向きが逆なら符号で合わせる）', () => {
    const pos = compensateRollForYaw(0, 0.4, 0.3);
    const neg = compensateRollForYaw(0, 0.4, -0.3);
    expect(neg).toBeCloseTo(-pos, 5);
  });

  it('yaw は maxYawRad でクランプ（暴発防止）', () => {
    const at = compensateRollForYaw(0, 0.7, 0.3);
    const beyond = compensateRollForYaw(0, 1.5, 0.3); // 0.7 にクランプ
    expect(beyond).toBeCloseTo(at, 5);
  });

  it('roll が不正値なら0（顔ロスト等）', () => {
    expect(compensateRollForYaw(NaN, 0.4, 0.3)).toBe(0);
    expect(compensateRollForYaw(Infinity, 0.4, 0.3)).toBe(0);
  });

  it('yaw が不正値なら roll を素通し', () => {
    expect(compensateRollForYaw(0.1, NaN, 0.3)).toBeCloseTo(0.1, 5);
    expect(compensateRollForYaw(0.1, Infinity, 0.3)).toBeCloseTo(0.1, 5);
  });
});
