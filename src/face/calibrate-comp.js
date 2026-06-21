// 方向校正（上下左右）に付随する「向きによるズレ補正」の逆算（純関数・副作用なし）。
//
// - computeSlidePoseCompX/Y: 左右(yaw)/上下(pitch)を向くと鼻先がフレーム内で動き、平行移動
//   していなくても立ち位置(posX/posY)がズレる。その分を打ち消す slidePoseCompX/Y を逆算する。
// - computeTiltYawComp: 左右を向くと roll に yaw 由来のかしげが混入し、傾けていなくてもアバター
//   がかしげる。その分を打ち消す tiltYawComp を逆算する。
// - computeZoomPitchComp: 上下を向くと foreshortening で顔が縦に縮み、距離が同じでもズームが
//   変わる。正面の基準サイズへ戻す zoomPitchComp を逆算する。
//
// いずれも「顔の向きだけ変えて（平行移動せず・距離を変えず）押す」前提。avatar-state.js の
// compensatePos / compensateRollForYaw / compensateScaleForPitch の式をそのまま解いた値を返す。
// 無効・補正不要は null。

const MAX_ANGLE_RAD = 0.7; // 各補正関数のクランプ（maxYawRad/maxPitchRad）と揃える

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}

// 位置ズレ補正の共通コア。avatar-state は compensatePos(pos, angle, comp, {invert}) =
//   pos - sign*comp*clamp(angle, ±0.7),  sign = invert ? -1 : 1
// を使う（X は angle=yaw、Y は angle=-pitch）。振り向きのみなら補正後 pos=0 になる comp を解く:
//   comp = pos / (sign * clamp(angle, ±0.7))
function slidePoseComp({ pos, angle, invert, minAngleRad, maxComp }) {
  if (!Number.isFinite(pos) || !Number.isFinite(angle)) return null;
  const a = clamp(angle, -MAX_ANGLE_RAD, MAX_ANGLE_RAD);
  if (Math.abs(a) < minAngleRad) return null; // 振り不足
  const sign = invert ? -1 : 1;
  const comp = pos / (sign * a);
  if (!(comp > 0)) return null; // 逆符号・ドリフト無し（補正不要）
  return Math.round(clamp(comp, 0, maxComp) * 100) / 100;
}

/**
 * 左右を向いたときの位置ズレ(posX)を打ち消す slidePoseCompX を逆算する（angle=yaw）。
 * @param {Object} p
 * @param {number} p.posX        今の生の立ち位置(-1..1, invertSlide 適用済み)
 * @param {number} p.yaw         今の生 yaw(rad)
 * @param {boolean} p.invertSlide 左右反転（avatar-state の invert と一致させる）
 * @param {number} [p.minYawRad=0.087] 補正を解くのに必要な最小 yaw(rad, 約5°)
 * @param {number} [p.maxComp=2] スライダー上限に合わせた頭打ち
 * @returns {number|null} slidePoseCompX（0.01刻み）。逆符号・振り不足・不正は null
 */
export function computeSlidePoseCompX({ posX, yaw, invertSlide, minYawRad = 0.087, maxComp = 2 }) {
  return slidePoseComp({ pos: posX, angle: yaw, invert: invertSlide, minAngleRad: minYawRad, maxComp });
}

/**
 * 上下を向いたときの位置ズレ(posY)を打ち消す slidePoseCompY を逆算する（angle=-pitch）。
 * @param {Object} p
 * @param {number} p.posY          今の生の立ち位置(-1..1, invertSlideY 適用済み)
 * @param {number} p.pitch         今の生 pitch(rad)
 * @param {boolean} p.invertSlideY 上下反転（avatar-state の invert と一致させる）
 * @param {number} [p.minPitchRad=0.087] 補正を解くのに必要な最小 |pitch|(rad, 約5°)
 * @param {number} [p.maxComp=2] スライダー上限に合わせた頭打ち
 * @returns {number|null} slidePoseCompY（0.01刻み）。逆符号・振り不足・不正は null
 */
export function computeSlidePoseCompY({ posY, pitch, invertSlideY, minPitchRad = 0.087, maxComp = 2 }) {
  return slidePoseComp({ pos: posY, angle: -pitch, invert: invertSlideY, minAngleRad: minPitchRad, maxComp });
}

/**
 * 左右を向いたときに roll へ混入するかしげを打ち消す tiltYawComp を逆算する。
 * avatar-state は compensateRollForYaw(roll - biasRoll, yaw, comp) =
 *   (roll - biasRoll) - comp*clamp(yaw, ±0.7)
 * を使う。実際にはかしげていない（振り向きのみ）なら補正後 0 になる comp を解く:
 *   comp = (roll - biasRoll) / clamp(yaw, ±0.7)
 * 混入は yaw の奇関数なので左右どちらの姿勢からでも同じ comp になる。符号付き。
 * @param {Object} p
 * @param {number} p.roll          今の生 roll(rad)
 * @param {number} p.yaw           今の生 yaw(rad)
 * @param {number} [p.biasRollRad=0] かしげ中立(rad)。straight 姿勢の roll を引く
 * @param {number} [p.minYawRad=0.087] 補正を解くのに必要な最小 yaw(rad, 約5°)
 * @param {number} [p.maxComp=4] 頭打ち。横向き(プロファイル)では roll が大きく yaw が 0.7 で
 *   頭打ちのため comp=roll/0.7 が 1 を超える。±1 だと飽和して傾きが残るので広めに取る。
 * @returns {number|null} tiltYawComp（0.01刻み, 符号付き）。振り不足・不正は null
 */
export function computeTiltYawComp({ roll, yaw, biasRollRad = 0, minYawRad = 0.087, maxComp = 4 }) {
  if (!Number.isFinite(roll) || !Number.isFinite(yaw)) return null;
  const a = clamp(yaw, -MAX_ANGLE_RAD, MAX_ANGLE_RAD);
  if (Math.abs(a) < minYawRad) return null; // 振り不足
  const comp = (roll - biasRollRad) / a;
  if (!Number.isFinite(comp)) return null;
  return Math.round(clamp(comp, -maxComp, maxComp) * 100) / 100;
}

/**
 * 上下を向いたときの顔サイズ変化(foreshortening)を打ち消す zoomPitchComp を逆算する。
 * avatar-state は compensateScaleForPitch(sz, pitch, comp) =
 *   sz * (1 + comp*(1/cos - 1)),  cos = cos(min(|pitch|, 0.7))
 * を使う。補正後サイズが baseline（正面の基準サイズ）に戻る comp を解く:
 *   needed = baseline / sz   （縮んでいれば >1）
 *   comp = (needed - 1) / (1/cos - 1)
 * @param {Object} p
 * @param {number} p.faceScale 今の見かけサイズ(>0)。上下を向いて縮んでいる想定
 * @param {number} p.pitch     今の生 pitch(rad)
 * @param {number} p.baseline  正面の基準サイズ(>0)。zoomBaseline か autoBaseline
 * @param {number} [p.minPitchRad=0.087] 補正を解くのに必要な最小 |pitch|(rad, 約5°)
 * @param {number} [p.maxComp=2] スライダー上限に合わせた頭打ち
 * @returns {number|null} zoomPitchComp（0.01刻み）。縮んでない・振り不足・不正は null
 */
export function computeZoomPitchComp({ faceScale, pitch, baseline, minPitchRad = 0.087, maxComp = 2 }) {
  if (!(faceScale > 0) || !(baseline > 0) || !Number.isFinite(pitch)) return null;
  const p = Math.min(Math.abs(pitch), MAX_ANGLE_RAD);
  if (p < minPitchRad) return null; // 振り不足
  const denom = (1 / Math.cos(p)) - 1;
  if (!(denom > 1e-6)) return null;
  const needed = baseline / faceScale;
  const comp = (needed - 1) / denom;
  if (!(comp > 0)) return null; // 縮んでいない（補正不要）
  return Math.round(clamp(comp, 0, maxComp) * 100) / 100;
}
