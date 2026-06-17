// signals(+tweaks) → 「状態フレーム」を作る純ロジック。
//
// docs-camera/05 の構成で producer(iPhone/ローカル) 側が毎フレーム実行する。派生・ゲイン・
// 反転・向き補正・表情の確定（口3段/まばたき）をここで済ませ、CEF へは小さな状態フレームだけ送る。
// 連続値(colX/rowY/tilt/slideX/slideY/zoom)は「平滑化前のターゲット」で、平滑化は受信側
// (apply-state.js)が担う＝ネットワークのジッタを吸収するため。sheet だけは離散値で即確定。
//
// 口エンベロープ・段階デバウンス・まばたきヒステリシス・ズーム自動基準は時間方向の状態を
// 持つので、呼び出し側が createExprState() の戻りを保持して毎フレーム渡す（この関数が更新する）。
import { compensatePos } from './pitch-compensated-pos';
import { compensateScaleForPitch } from './pitch-compensated-scale';

const DEG = Math.PI / 180;
// 口が開くときの追従係数（閉じるときは tweaks.release を使う＝開きは速く・閉じはゆっくり）
const MOUTH_ATTACK = 0.6;
// 口の段階(0/1/2)を切り替える最小間隔(ms)。チラつき防止のデバウンス。
const MOUTH_DEBOUNCE_MS = 60;

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}

/**
 * @typedef {Object} StateFrame
 * @property {boolean} faceDetected 顔検出中か（false=ロスト。受信側は向きを据え置く）
 * @property {number} colX グリッド列ターゲット(-1..1, 平滑化前)
 * @property {number} rowY グリッド行ターゲット(-1..1, 平滑化前)
 * @property {number} tilt 首かしげ(deg, ゲイン確定後・平滑化前)
 * @property {number} slideX 左右スライド(vw, 確定後・平滑化前)
 * @property {number} slideY 上下スライド(vh, 確定後・平滑化前)
 * @property {number} zoom ズーム率(scale, 確定後・平滑化前)
 * @property {number} sheet シート番号(0..5 = A..F: 目開閉×口3段)
 */

/**
 * 時間方向の状態（口エンベロープ・デバウンス・まばたきヒステリシス・ズーム自動基準）。
 * producer 側で1つ保持し、computeStateFrame に毎フレーム渡す。
 */
export function createExprState() {
  return {
    mouthEnv: 0,      // 口の開きの平滑化エンベロープ
    lastMouth: 0,     // 確定済みの口段階(0/1/2)
    lastSwitch: 0,    // 最後に段階を切り替えた時刻(ms)
    blinkState: false, // まばたきヒステリシスの開閉状態
    autoBaseline: 0,  // ズームの自動基準（手動較正が無いときの初回検出サイズ）
  };
}

/**
 * @param {Object} signals deriveFaceSignals 相当 + faceScale。
 *   { x, y, yaw, pitch, roll, posX, posY, faceScale, mouth, eyesClosed }
 * @param {Object} t tweaks（mouthGain/thHalf/... 一式）
 * @param {ReturnType<typeof createExprState>} expr 時間状態（この関数が更新する）
 * @param {number} now performance.now() 相当(ms)
 * @param {{ blinkOverride?: boolean }} [opts] blinkSync OFF 時の自動まばたき状態
 * @returns {StateFrame}
 */
export function computeStateFrame(signals, t, expr, now, opts = {}) {
  // 顔がフレーム内にあるか。ロスト時は faceScale=0 になる（use-face-pose の applySignals 仕様）。
  const facePresent = signals.faceScale > 0;

  // 口パク: jawOpen(0..1)*gain を envelope（開きは速く・閉じは release）→ しきい値で3段に。
  const raw = signals.mouth * t.mouthGain;
  if (raw > expr.mouthEnv) expr.mouthEnv += (raw - expr.mouthEnv) * MOUTH_ATTACK;
  else expr.mouthEnv += (raw - expr.mouthEnv) * t.release;
  const lv = expr.mouthEnv;
  const m = lv >= t.thFull ? 2 : lv >= t.thHalf ? 1 : 0;
  if (m !== expr.lastMouth && now - expr.lastSwitch > MOUTH_DEBOUNCE_MS) {
    expr.lastMouth = m;
    expr.lastSwitch = now;
  }
  const mouthLevel = expr.lastMouth;

  // まばたき: 同調ON はヒステリシスで実眼に追従、OFF は自動まばたき(blinkOverride)に委譲。
  let blink;
  if (t.blinkSync) {
    const denom = Math.max(0.05, 1 - t.eyesOpenBias);
    const closed = clamp((signals.eyesClosed - t.eyesOpenBias) / denom, 0, 1);
    const closeTh = clamp(0.5 / t.blinkSensitivity, 0.15, 0.9);
    const openTh = closeTh * 0.6; // ヒステリシス（チラつき防止）
    if (!expr.blinkState && closed > closeTh) expr.blinkState = true;
    else if (expr.blinkState && closed < openTh) expr.blinkState = false;
    blink = expr.blinkState;
  } else {
    blink = !!opts.blinkOverride;
  }
  const sheet = (blink ? 3 : 0) + mouthLevel;

  // 首かしげ(roll)
  const tilt = t.tiltEnabled
    ? clamp((signals.roll / DEG) * t.tiltGain * (t.invertTilt ? -1 : 1), -t.tiltMax, t.tiltMax)
    : 0;

  // 左右上下スライド。頭の回転(yaw/pitch)が鼻先に混入する分を compensatePos で打ち消す。
  // 顔ロスト中は posX/posY が中立(0)・pose は保持なので補正を掛けない（誤差防止）。
  const posX = facePresent
    ? compensatePos(signals.posX, signals.yaw, t.slidePoseComp, { invert: t.invertSlide })
    : signals.posX;
  const posY = facePresent
    ? compensatePos(signals.posY, -signals.pitch, t.slidePoseComp, { invert: t.invertSlideY })
    : signals.posY;
  const slideX = t.slideEnabled ? clamp(posX * t.slideGain, -t.slideMax, t.slideMax) : 0;
  const slideY = t.slideEnabled ? clamp(posY * t.slideGainY, -t.slideMaxY, t.slideMaxY) : 0;

  // ズーム: 見かけサイズ ÷ 基準 が距離比。基準は手動較正(zoomBaseline)優先、無ければ
  // 初回検出サイズを自動基準にする。下/上向きの foreshortening は補正してから比を取る。
  let zoom = 1;
  const sz = compensateScaleForPitch(signals.faceScale, signals.pitch, t.zoomPitchComp);
  if (t.zoomEnabled && sz > 0) {
    let baseline = t.zoomBaseline > 0 ? t.zoomBaseline : expr.autoBaseline;
    if (!(baseline > 0)) {
      expr.autoBaseline = sz;
      baseline = sz;
    }
    const ratio = sz / baseline;
    zoom = clamp(1 + (ratio - 1) * t.zoomGain, t.zoomMin, t.zoomMax);
  }

  return {
    faceDetected: facePresent,
    colX: signals.x,
    rowY: signals.y,
    tilt,
    slideX,
    slideY,
    zoom,
    sheet,
  };
}
