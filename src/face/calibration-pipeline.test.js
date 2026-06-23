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

// 内的回転 R=Rx(pitchRot)·Ry(yawRot) の 4x4(列優先)。純粋な首振りで生じる見かけの
// かしげ（roll=atan2(sin·sin, cos)）を含む、物理的に整合した行列を作る（右ベクトルが傾く）。
function rotMatrix(yawRot, pitchRot) {
  const cy = Math.cos(yawRot);
  const sy = Math.sin(yawRot);
  const cp = Math.cos(pitchRot);
  const sp = Math.sin(pitchRot);
  return [
    cy, sp * sy, -cp * sy, 0, // 右ベクトル
    0, cp, sp, 0, // 上ベクトル
    sy, -sp * cy, cp * cy, 0, // 前方ベクトル
    0, 0, 0, 1,
  ];
}

// 行列から poseFromMatrix で読み戻した生の {yaw, pitch, roll}（実行時 signals と同じ値）。
function posed(yawRot, pitchRot) {
  const p = poseFromMatrix(rotMatrix(yawRot, pitchRot));
  return { yaw: p.yaw, pitch: p.pitch, roll: p.roll };
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
  it('右を向いて校正した姿勢で、その姿勢のかしげが 0 になる', () => {
    const s = posed(0.7, 0.26); // 右 40° + 少し下向き（混入あり）
    const comp = computeTiltYawComp({ roll: s.roll, yaw: s.yaw, pitch: s.pitch, biasRollRad: 0 });
    const t = tweaks({ tiltYawComp: comp, biasRollDeg: 0 });
    const f = computeStateFrame(signals({ roll: s.roll, yaw: s.yaw, pitch: s.pitch }), t, createExprState(), 0);
    expect(Math.abs(f.tilt)).toBeLessThan(0.5); // かしげ ~0°
  });

  it('校正と違う pitch で振り向いてもかしげが残らない（支配的バグの回帰）', () => {
    // 校正: 下向き ~15°で右 40°。使用: 下向き ~5°で同じ右 40°（pitch が違う）。
    // 旧 yaw 単独モデルでは ~8° 残っていた。
    const cal = posed(0.7, 0.26);
    const comp = computeTiltYawComp({ roll: cal.roll, yaw: cal.yaw, pitch: cal.pitch, biasRollRad: 0 });
    const t = tweaks({ tiltYawComp: comp, tiltGain: 1.3, tiltMax: 23 });
    const use = posed(0.7, 0.087);
    const f = computeStateFrame(signals({ roll: use.roll, yaw: use.yaw, pitch: use.pitch }), t, createExprState(), 0);
    expect(Math.abs(f.tilt)).toBeLessThan(1.5);
  });

  it('右で校正した補正は左を向いた姿勢でも 0 にする（奇関数で対称・単一comp）', () => {
    const cal = posed(0.7, 0.26);
    const comp = computeTiltYawComp({ roll: cal.roll, yaw: cal.yaw, pitch: cal.pitch, biasRollRad: 0 });
    const t = tweaks({ tiltYawComp: comp });
    const left = posed(-0.7, 0.26);
    const f = computeStateFrame(signals({ roll: left.roll, yaw: left.yaw, pitch: left.pitch }), t, createExprState(), 0);
    expect(Math.abs(f.tilt)).toBeLessThan(1.5);
  });

  it('中間の振り角でもかしげが小さい（tan 形の非線形を基底で吸収）', () => {
    const cal = posed(0.7, 0.26);
    const comp = computeTiltYawComp({ roll: cal.roll, yaw: cal.yaw, pitch: cal.pitch, biasRollRad: 0 });
    const t = tweaks({ tiltYawComp: comp });
    const mid = posed(0.35, 0.26); // 同 pitch・浅い振り
    const f = computeStateFrame(signals({ roll: mid.roll, yaw: mid.yaw, pitch: mid.pitch }), t, createExprState(), 0);
    expect(Math.abs(f.tilt)).toBeLessThan(1.5);
  });

  it('かしげ中立(biasRoll)があっても、補正後は straight も turn も 0 になる', () => {
    // straight(正面) で常時 roll=0.02 の傾き → 正ボタンが biasRollDeg に記録した想定。
    const biasRollDeg = Math.round(0.02 / DEG);
    const s = posed(0.7, 0.26); // 右向き＋下向き（混入あり）
    // 計測 roll は「常時の傾き 0.02 + yaw×pitch 混入」。
    const comp = computeTiltYawComp({
      roll: 0.02 + s.roll, yaw: s.yaw, pitch: s.pitch, biasRollRad: biasRollDeg * DEG,
    });
    const t = tweaks({ tiltYawComp: comp, biasRollDeg });
    const straight = computeStateFrame(signals({ roll: 0.02, yaw: 0, pitch: 0 }), t, createExprState(), 0);
    const right = computeStateFrame(signals({ roll: 0.02 + s.roll, yaw: s.yaw, pitch: s.pitch }), t, createExprState(), 0);
    expect(Math.abs(straight.tilt)).toBeLessThan(1.5); // 中立で ~0
    expect(Math.abs(right.tilt)).toBeLessThan(1.5); // 右でも ~0
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
