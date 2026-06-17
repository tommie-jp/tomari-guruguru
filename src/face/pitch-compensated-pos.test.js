import { describe, it, expect } from 'vitest';
import { compensatePos } from './pitch-compensated-pos';

describe('compensatePos', () => {
  it('正面(normAngle=0)では補正せず素通し', () => {
    expect(compensatePos(0.3, 0, 0.6)).toBeCloseTo(0.3, 5);
  });

  it('下向き(normAngleY=-pitch>0)で下ズレを打ち消す（posが小さくなる方向）', () => {
    // Arrange: 下を向くと posY が +0.4 にズレている。-pitch>0 を渡す。
    const rawPosY = 0.4;
    const normAngleY = 0.3; // = -pitch（下向き）
    // Act
    const out = compensatePos(rawPosY, normAngleY, 0.6);
    // Assert: 中央(0)へ近づく
    expect(out).toBeCloseTo(0.4 - 0.6 * 0.3, 5);
    expect(out).toBeLessThan(rawPosY);
  });

  it('右向き(normAngleX=yaw>0)で右ズレを打ち消す', () => {
    const out = compensatePos(0.4, 0.3, 0.6);
    expect(out).toBeLessThan(0.4);
  });

  it('gain=0 なら無補正（従来挙動）', () => {
    expect(compensatePos(0.4, 0.3, 0)).toBeCloseTo(0.4, 5);
  });

  it('invert=true で補正の符号が反転する', () => {
    const normal = compensatePos(0.4, 0.3, 0.6, { invert: false });
    const inverted = compensatePos(0.4, 0.3, 0.6, { invert: true });
    // 反転すると rawPos から見て逆方向に補正される
    expect(normal).toBeLessThan(0.4);
    expect(inverted).toBeGreaterThan(0.4);
  });

  it('|normAngle| は maxAngleRad でクランプ（暴発防止）', () => {
    const atMax = compensatePos(0.0, 0.7, 1, { maxAngleRad: 0.7 });
    const beyond = compensatePos(0.0, 1.5, 1, { maxAngleRad: 0.7 });
    expect(beyond).toBeCloseTo(atMax, 5);
  });

  it('結果は -1..1 にクランプ', () => {
    expect(compensatePos(0.0, -0.7, 2)).toBe(1); // 0 - 2*(-0.7)=1.4 → 上限1
    expect(compensatePos(0.0, 0.7, 2)).toBe(-1); // 0 - 2*(0.7)=-1.4 → 下限-1
  });

  it('rawPos が非有限なら 0', () => {
    expect(compensatePos(NaN, 0.3, 0.6)).toBe(0);
  });

  it('normAngle が不正なら素通し', () => {
    expect(compensatePos(0.4, NaN, 0.6)).toBeCloseTo(0.4, 5);
  });
});
