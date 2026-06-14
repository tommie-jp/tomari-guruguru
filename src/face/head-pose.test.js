import { describe, it, expect } from 'vitest';
import { poseFromMatrix } from './head-pose';

// 列優先(column-major)の 4x4 同次変換行列を組み立てるヘルパ。
// 回転3x3を [右ベクトル, 上ベクトル, 前方ベクトル] の列として渡す。
function matrix({ right, up, fwd, t = [0, 0, 0] }) {
  return [
    right[0], right[1], right[2], 0,
    up[0], up[1], up[2], 0,
    fwd[0], fwd[1], fwd[2], 0,
    t[0], t[1], t[2], 1,
  ];
}

const IDENTITY = matrix({ right: [1, 0, 0], up: [0, 1, 0], fwd: [0, 0, 1] });

describe('poseFromMatrix', () => {
  it('単位行列（正面）では x/y/roll が 0 になる', () => {
    // Arrange / Act
    const pose = poseFromMatrix(IDENTITY);

    // Assert
    expect(pose.x).toBeCloseTo(0, 5);
    expect(pose.y).toBeCloseTo(0, 5);
    expect(pose.roll).toBeCloseTo(0, 5);
  });

  it('右を向くと x が正になる（前方ベクトルの x 成分）', () => {
    // Arrange: 前方ベクトルを右へ傾ける
    const data = matrix({ right: [1, 0, 0], up: [0, 1, 0], fwd: [0.5, 0, 0.866] });

    // Act
    const pose = poseFromMatrix(data);

    // Assert
    expect(pose.x).toBeGreaterThan(0);
    expect(pose.yaw).toBeGreaterThan(0);
  });

  it('上を向くと y が負になる（グリッドは上が r0）', () => {
    // Arrange: 前方ベクトルを上へ（MediaPipe は y 上向き正）
    const data = matrix({ right: [1, 0, 0], up: [0, 0.866, -0.5], fwd: [0, 0.5, 0.866] });

    // Act
    const pose = poseFromMatrix(data);

    // Assert
    expect(pose.y).toBeLessThan(0);
    expect(pose.pitch).toBeGreaterThan(0);
  });

  it('首を傾ける（右ベクトルが回転）と roll の符号が変わる', () => {
    // Arrange: 視線軸まわりに +30度ロール → 右ベクトルが (cos, sin, 0)
    const a = (30 * Math.PI) / 180;
    const tilted = matrix({
      right: [Math.cos(a), Math.sin(a), 0],
      up: [-Math.sin(a), Math.cos(a), 0],
      fwd: [0, 0, 1],
    });

    // Act
    const pose = poseFromMatrix(tilted);

    // Assert: 約 0.523rad(30度)、符号は一定方向
    expect(pose.roll).toBeCloseTo(a, 2);

    // 反対向きのロールは符号が反転する
    const back = matrix({
      right: [Math.cos(-a), Math.sin(-a), 0],
      up: [Math.sin(a), Math.cos(a), 0],
      fwd: [0, 0, 1],
    });
    expect(poseFromMatrix(back).roll).toBeCloseTo(-a, 2);
  });
});
