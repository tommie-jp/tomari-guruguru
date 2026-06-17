import { describe, it, expect } from 'vitest';
import { compensateScaleForPitch } from './pitch-compensated-scale';

describe('compensateScaleForPitch', () => {
  it('正面(pitch=0)では補正せず素通し', () => {
    // Arrange / Act
    const out = compensateScaleForPitch(0.4, 0);
    // Assert
    expect(out).toBeCloseTo(0.4, 5);
  });

  it('下向き(pitch>0)は 1/cos(pitch) 倍に戻す（既定 comp=1）', () => {
    // Arrange
    const raw = 0.4;
    const pitch = 0.5;
    // Act
    const out = compensateScaleForPitch(raw, pitch);
    // Assert: 正面相当へ復元
    expect(out).toBeCloseTo(raw / Math.cos(pitch), 5);
    expect(out).toBeGreaterThan(raw);
  });

  it('上向き(pitch<0)も対称に補正する', () => {
    const down = compensateScaleForPitch(0.4, 0.5);
    const up = compensateScaleForPitch(0.4, -0.5);
    expect(up).toBeCloseTo(down, 5);
  });

  it('comp=0 なら無補正（従来挙動）', () => {
    expect(compensateScaleForPitch(0.4, 0.5, 0)).toBeCloseTo(0.4, 5);
  });

  it('comp=0.5 なら効きが半分（無補正と完全補正の中間）', () => {
    const raw = 0.4;
    const pitch = 0.5;
    const full = compensateScaleForPitch(raw, pitch, 1);
    const half = compensateScaleForPitch(raw, pitch, 0.5);
    expect(half).toBeGreaterThan(raw);
    expect(half).toBeLessThan(full);
  });

  it('|pitch| は maxPitchRad でクランプ（暴発防止）', () => {
    const clampedAt = compensateScaleForPitch(0.4, 0.7, 1);
    const beyond = compensateScaleForPitch(0.4, 1.5, 1); // 0.7 にクランプされる
    expect(beyond).toBeCloseTo(clampedAt, 5);
  });

  it('倍率は maxFactor で頭打ち', () => {
    // maxFactor=1.1 を指定すると 1/cos(0.5)=1.139… が 1.1 で頭打ち
    const out = compensateScaleForPitch(1.0, 0.5, 1, { maxFactor: 1.1 });
    expect(out).toBeCloseTo(1.1, 5);
  });

  it('サイズ0以下は0（顔ロスト相当）', () => {
    expect(compensateScaleForPitch(0, 0.5)).toBe(0);
    expect(compensateScaleForPitch(-0.2, 0.5)).toBe(0);
  });

  it('pitch が不正値なら素通し', () => {
    expect(compensateScaleForPitch(0.4, NaN)).toBeCloseTo(0.4, 5);
    expect(compensateScaleForPitch(0.4, Infinity)).toBeCloseTo(0.4, 5);
  });
});
