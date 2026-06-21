// 方向校正（上下左右）に付随する「向きによるズレ補正」の逆算（純関数・副作用なし）。
//
// - computeSlidePoseCompX: 左右を向くと鼻先がフレーム内で動き、平行移動していなくても
//   立ち位置(posX)がズレる。その分を打ち消す slidePoseCompX を、振り切った姿勢から逆算する。
// - computeZoomPitchComp: 上下を向くと foreshortening で顔が縦に縮み、距離が同じでもズームが
//   変わる。正面の基準サイズへ戻す zoomPitchComp を、振り切った姿勢から逆算する。
//
// いずれも「顔の向きだけ変えて（平行移動せず・距離を変えず）押す」前提。avatar-state.js の
// compensatePos / compensateScaleForPitch の式をそのまま解いた値を返す。無効・補正不要は null。

const MAX_ANGLE_RAD = 0.7; // compensatePos / compensateScaleForPitch のクランプと揃える

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}

/**
 * 左右を向いたときの位置ズレ(posX)を打ち消す slidePoseCompX を逆算する。
 * avatar-state は compensatePos(posX, yaw, comp, {invert}) =
 *   posX - sign*comp*clamp(yaw, ±0.7),  sign = invert ? -1 : 1
 * を使う。振り向きのみ（平行移動なし）なら補正後 posX=0 になる comp を解く:
 *   comp = posX / (sign * clamp(yaw, ±0.7))
 * @param {Object} p
 * @param {number} p.posX        今の生の立ち位置(-1..1, invertSlide 適用済み)
 * @param {number} p.yaw         今の生 yaw(rad)
 * @param {boolean} p.invertSlide 左右反転（avatar-state の invert と一致させる）
 * @param {number} [p.minYawRad=0.087] 補正を解くのに必要な最小 yaw(rad, 約5°)
 * @param {number} [p.maxComp=2] スライダー上限に合わせた頭打ち
 * @returns {number|null} slidePoseCompX（0.01刻み）。逆符号・振り不足・不正は null
 */
export function computeSlidePoseCompX({ posX, yaw, invertSlide, minYawRad = 0.087, maxComp = 2 }) {
  if (!Number.isFinite(posX) || !Number.isFinite(yaw)) return null;
  const a = clamp(yaw, -MAX_ANGLE_RAD, MAX_ANGLE_RAD);
  if (Math.abs(a) < minYawRad) return null; // 振り不足
  const sign = invertSlide ? -1 : 1;
  const comp = posX / (sign * a);
  if (!(comp > 0)) return null; // 逆符号・ドリフト無し（補正不要）
  return Math.round(clamp(comp, 0, maxComp) * 100) / 100;
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
