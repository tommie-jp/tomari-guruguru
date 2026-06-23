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

  it('pitch≠0 で左右に振ると roll が混入する（atan2(sin p·sin y, cos y)）', () => {
    // 内的回転 R=Rx(pitch)·Ry(yaw): 右ベクトルが傾き、傾けていなくても roll が出る。
    // pitch=0 のときは roll=0（純ヨーでは混入しない）= 旧テストが見落としていた挙動。
    const rot = (yawRot, pitchRot) => {
      const cy = Math.cos(yawRot);
      const sy = Math.sin(yawRot);
      const cp = Math.cos(pitchRot);
      const sp = Math.sin(pitchRot);
      return matrix({
        right: [cy, sp * sy, -cp * sy],
        up: [0, cp, sp],
        fwd: [sy, -sp * cy, cp * cy],
      });
    };
    // 純ヨー（pitch=0）では roll=0
    expect(poseFromMatrix(rot(0.7, 0)).roll).toBeCloseTo(0, 5);
    // pitch がある状態で右を向くと roll が混入し、解析式に一致する
    const pose = poseFromMatrix(rot(0.7, 0.26));
    const expected = Math.atan2(Math.sin(0.26) * Math.sin(0.7), Math.cos(0.7));
    expect(pose.roll).toBeCloseTo(expected, 5);
    expect(Math.abs(pose.roll)).toBeGreaterThan(0.1); // 無視できない混入（~12°）
  });
});

// 前方ベクトルを yaw(右が正)・pitch(上が正) から組み立てるヘルパ。
// 片方ずつ振る前提（両方 0 でないときの depth は cos*cos の近似）。
function fwdMatrix(yaw, pitch) {
  const fwd = [Math.sin(yaw), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
  return matrix({ right: [1, 0, 0], up: [0, 1, 0], fwd });
}

describe('poseFromMatrix 非対称レンジ（上下左右で別々の振り幅）', () => {
  it('右と左で別々のレンジが効く（右は浅く端へ・左は深く）', () => {
    const opts = { maxYawRight: 0.2, maxYawLeft: 0.5 };
    // 右に 0.2rad → 0.2/0.2 = 1（端）
    expect(poseFromMatrix(fwdMatrix(0.2, 0), opts).x).toBeCloseTo(1, 2);
    // 左に 0.2rad → -0.2/0.5 = -0.4（まだ端ではない）
    expect(poseFromMatrix(fwdMatrix(-0.2, 0), opts).x).toBeCloseTo(-0.4, 2);
  });

  it('上と下で別々のレンジが効く（上は浅く端へ・下は深く）', () => {
    const opts = { maxPitchUp: 0.2, maxPitchDown: 0.5 };
    // 上向き(pitch正)は y を負に。0.2/0.2 = 1 → y=-1
    expect(poseFromMatrix(fwdMatrix(0, 0.2), opts).y).toBeCloseTo(-1, 2);
    // 下向き(pitch負)。0.2/0.5 = 0.4 → y=+0.4
    expect(poseFromMatrix(fwdMatrix(0, -0.2), opts).y).toBeCloseTo(0.4, 2);
  });

  it('校正した振り切り角がちょうど端(±1)に対応する', () => {
    const opts = { maxYawRight: 0.35, maxPitchDown: 0.45 };
    expect(poseFromMatrix(fwdMatrix(0.35, 0), opts).x).toBeCloseTo(1, 2);
    expect(poseFromMatrix(fwdMatrix(0, -0.45), opts).y).toBeCloseTo(1, 2);
  });

  it('後方互換: maxYaw/maxPitch だけ指定なら左右上下に共通で効く', () => {
    const r = poseFromMatrix(fwdMatrix(0.25, 0), { maxYaw: 0.5 });
    const l = poseFromMatrix(fwdMatrix(-0.25, 0), { maxYaw: 0.5 });
    expect(r.x).toBeCloseTo(0.5, 2);
    expect(l.x).toBeCloseTo(-0.5, 2);
    const u = poseFromMatrix(fwdMatrix(0, 0.2), { maxPitch: 0.4 });
    const d = poseFromMatrix(fwdMatrix(0, -0.2), { maxPitch: 0.4 });
    expect(u.y).toBeCloseTo(-0.5, 2);
    expect(d.y).toBeCloseTo(0.5, 2);
  });

  it('レンジが 0（壊れた保存値）でも NaN を出さず有限値に丸める', () => {
    const p = poseFromMatrix(fwdMatrix(0.2, 0.2), { maxYawRight: 0, maxPitchUp: 0 });
    expect(Number.isFinite(p.x)).toBe(true);
    expect(Number.isFinite(p.y)).toBe(true);
    expect(p.x).toBeGreaterThanOrEqual(-1);
    expect(p.x).toBeLessThanOrEqual(1);
  });

  it('片側だけ指定したときは反対側は maxYaw/maxPitch にフォールバックする', () => {
    // maxYawRight だけ上書き、左は maxYaw(0.5) のまま
    const opts = { maxYaw: 0.5, maxYawRight: 0.25 };
    expect(poseFromMatrix(fwdMatrix(0.25, 0), opts).x).toBeCloseTo(1, 2);
    expect(poseFromMatrix(fwdMatrix(-0.25, 0), opts).x).toBeCloseTo(-0.5, 2);
  });
});
