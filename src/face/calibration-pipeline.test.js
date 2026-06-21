// 方向校正の「逆算 → 実行時パイプライン」の往復を端から端まで検証する統合テスト。
// 右/左を向いた姿勢で校正すると、その姿勢でアバターのかしげ・位置ズレが ~0 になることを、
// computeTiltYawComp / computeSlidePoseComp* が出す値を computeStateFrame に通して確認する。
import { describe, it, expect } from 'vitest';
import { computeStateFrame, createExprState } from './avatar-state';
import { poseFromMatrix } from './head-pose';
import { computeDirectionRange } from './direction-range';
import {
  computeTiltYawComp, computeSlidePoseCompX, computeSlidePoseCompY,
} from './calibrate-comp';

const DEG = Math.PI / 180;

// 前方ベクトルを yaw(右+)・pitch(上+) から組む 4x4(列優先)。
function fwdMatrix(yaw, pitch) {
  const f = [Math.sin(yaw), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
  return [1, 0, 0, 0, 0, 1, 0, 0, f[0], f[1], f[2], 0, 0, 0, 0, 1];
}

// computeStateFrame が読む tweak 一式（必要な項目だけ・既定は補正OFF相当）。
function tweaks(over = {}) {
  return {
    mouthGain: 1.3, thHalf: 0.12, thFull: 0.35, release: 0.25,
    blinkSync: true, blinkSensitivity: 1.0, eyesOpenBias: 0,
    tiltEnabled: true, tiltGain: 1.0, tiltMax: 45, invertTilt: false,
    tiltYawComp: 0, biasRollDeg: 0,
    slideEnabled: true, slideGain: 12, slideMax: 30, invertSlide: false,
    slideGainY: 12, slideMaxY: 30, invertSlideY: false,
    slidePoseCompX: 0, slidePoseCompY: 0, slidePoseCompXY: 0,
    zoomEnabled: false, zoomGain: 1.0, zoomMin: 0.6, zoomMax: 1.8,
    zoomPitchComp: 0, zoomMouthComp: 0, zoomBaseline: 0,
    ...over,
  };
}

function signals(over = {}) {
  return {
    x: 0, y: 0, yaw: 0, pitch: 0, roll: 0,
    posX: 0, posY: 0, faceScale: 0.3, mouth: 0, eyesClosed: 0,
    ...over,
  };
}

describe('方向校正 → 実行時パイプラインの往復', () => {
  it('右を向いた姿勢で校正すると、その姿勢でアバターのかしげが 0 になる', () => {
    // 右を向いて roll に 0.08rad のかしげが混入している姿勢。
    const pose = { yaw: 0.4, roll: 0.08 };
    const comp = computeTiltYawComp({ roll: pose.roll, yaw: pose.yaw, biasRollRad: 0 });
    const t = tweaks({ tiltYawComp: comp, biasRollDeg: 0 });
    const f = computeStateFrame(signals({ roll: pose.roll, yaw: pose.yaw }), t, createExprState(), 0);
    expect(f.tilt).toBeCloseTo(0, 1); // かしげ ~0°
  });

  it('横向き(プロファイル)で roll が大きくても、校正後はかしげが 0 になる（±1 飽和の回帰）', () => {
    // 右を向き切った姿勢: yaw=0.7(クランプ端)・roll=0.95 の大きな混入。
    // 旧 ±1 クランプでは comp=1 で飽和し tilt≈0.25rad(≈18°)残っていた。
    const pose = { yaw: 0.7, roll: 0.95 };
    const comp = computeTiltYawComp({ roll: pose.roll, yaw: pose.yaw, biasRollRad: 0 });
    expect(Math.abs(comp)).toBeGreaterThan(1); // 飽和していない
    const t = tweaks({ tiltYawComp: comp, biasRollDeg: 0, tiltGain: 1.3, tiltMax: 23 });
    const f = computeStateFrame(signals({ roll: pose.roll, yaw: pose.yaw }), t, createExprState(), 0);
    expect(Math.abs(f.tilt)).toBeLessThan(1); // かしげ ~0°（飽和なら ~18°残る）
  });

  it('右で校正したかしげ補正は、左を向いた姿勢でも 0 にする（奇関数で対称）', () => {
    // 右(yaw+,roll+)で得た comp は、左(yaw-,roll-)でも tilt~0 にする。
    const comp = computeTiltYawComp({ roll: 0.08, yaw: 0.4, biasRollRad: 0 });
    const t = tweaks({ tiltYawComp: comp });
    const left = computeStateFrame(signals({ roll: -0.08, yaw: -0.4 }), t, createExprState(), 0);
    expect(left.tilt).toBeCloseTo(0, 1);
  });

  it('かしげ中立(biasRoll)があっても、補正後は straight も turn も 0 になる', () => {
    // straight で roll=0.02(常時の傾き) → 正ボタンが biasRollDeg に記録した想定。
    const biasRollDeg = Math.round(0.02 / DEG);
    // 右では roll=0.10 (= 0.02 常時 + 0.08 混入)。
    const comp = computeTiltYawComp({ roll: 0.10, yaw: 0.4, biasRollRad: biasRollDeg * DEG });
    const t = tweaks({ tiltYawComp: comp, biasRollDeg });
    const straight = computeStateFrame(signals({ roll: 0.02, yaw: 0 }), t, createExprState(), 0);
    const right = computeStateFrame(signals({ roll: 0.10, yaw: 0.4 }), t, createExprState(), 0);
    expect(Math.abs(straight.tilt)).toBeLessThan(1.5); // 中立で ~0
    expect(Math.abs(right.tilt)).toBeLessThan(1.5);    // 右でも ~0
  });

  it('右を向いた姿勢で校正すると、その姿勢で左右の位置ズレが ~0 になる', () => {
    const pose = { yaw: 0.4, posX: 0.2 };
    const comp = computeSlidePoseCompX({ posX: pose.posX, yaw: pose.yaw, invertSlide: false });
    const t = tweaks({ slidePoseCompX: comp, invertSlide: false });
    const f = computeStateFrame(signals({ posX: pose.posX, yaw: pose.yaw }), t, createExprState(), 0);
    expect(Math.abs(f.slideX)).toBeLessThan(0.5); // ~0vw
  });

  it('下を向いた姿勢で校正すると、その姿勢で上下の位置ズレが ~0 になる', () => {
    const pose = { pitch: -0.4, posY: 0.2 };
    const comp = computeSlidePoseCompY({ posY: pose.posY, pitch: pose.pitch, invertSlideY: false });
    const t = tweaks({ slidePoseCompY: comp, invertSlideY: false });
    const f = computeStateFrame(signals({ posY: pose.posY, pitch: pose.pitch }), t, createExprState(), 0);
    expect(Math.abs(f.slideY)).toBeLessThan(0.5); // ~0vh
  });
});

// 方向校正 → 顔向き(x/y)の往復。右/左/上/下で校正すると、その姿勢が画面端(±1)に届く
// （= デバッグパネルの x/y が ±1.00、列/行が端になる）ことを端から端まで確認する。
describe('方向校正 → 向き(x)が画面端(±1)に届く', () => {
  const sens = 1.3;
  const biasYawDeg = -8;

  function xAfterCalib(dir, yaw) {
    const res = computeDirectionRange({
      yawRad: yaw, pitchRad: 0, biasYawDeg, biasPitchDeg: 0, dir, sensitivity: sens,
    });
    // camera-app と同じく poseOptions の片側レンジを組む（感度で割る）。
    const maxYawRight = res.key === 'rangeYawRightDeg' ? (res.deg * DEG) / sens : 1;
    const maxYawLeft = res.key === 'rangeYawLeftDeg' ? (res.deg * DEG) / sens : 1;
    // invertX は端の符号だけなので大きさ確認のため false。biasYaw は度→rad。
    const pose = poseFromMatrix(fwdMatrix(yaw, 0), {
      maxYawRight, maxYawLeft, biasYaw: biasYawDeg * DEG, invertX: false,
    });
    return pose.x;
  }

  it('右ボタン: 右を向いた姿勢の x が右端(=1.00)になる', () => {
    expect(xAfterCalib('right', 0.5)).toBe(1); // クランプで厳密に 1.00
  });

  it('左ボタン: 左を向いた姿勢の x が左端(=-1.00)になる', () => {
    expect(xAfterCalib('left', -0.5)).toBe(-1);
  });

  it('別の振り角でも、その姿勢が端(±1)に届く（floor 切り捨てで 0.99 止まりにしない）', () => {
    expect(xAfterCalib('right', 0.33)).toBe(1);
    expect(xAfterCalib('right', 0.7)).toBe(1);
  });
});
