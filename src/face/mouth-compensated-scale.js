// 顔の見かけサイズ(faceScale)から「口を開けたことによる顎ドロップ分」を打ち消す純関数
// （副作用なし・テスト容易）。
//
// faceScale はバウンディングボックスの高さ（face-scale.js = maxY-minY）。口を開くと顎・
// 下唇が下がって下端(maxY)が伸び、距離が同じでも高さが増える → ズーム率が上がってしまう。
// 顎ドロップ量は見かけサイズにほぼ比例する（近いほど大きく写る）ので、開き量(mouth, jawOpen
// 0..1)に応じて rawScale を乗算で縮めるのが距離不変で素直。
//
// comp(0..) は効きの強さ。comp=0 で無補正（従来挙動）、mouth=1 のとき (1-comp) 倍に縮める。
// 校正(zoomBaseline)は口を閉じた姿勢で取る前提なので、開いたときだけ基準サイズへ戻る。
// 暴発防止に mouth を 0..1 にクランプし、縮小率を maxReduction で頭打ちにする。

/**
 * @param {number} rawScale 生の見かけサイズ(0..1)。0以下なら0を返す
 * @param {number} mouth    口の開き(jawOpen, 0..1)。範囲外はクランプ
 * @param {number} [comp=0] 補正の強さ。0以下は無補正
 * @param {{ maxReduction?: number }} [opts] 縮小率の上限（既定0.6＝最大でも0.4倍まで）
 * @returns {number} 補正後の見かけサイズ
 */
export function compensateScaleForMouth(rawScale, mouth, comp = 0, opts = {}) {
  const { maxReduction = 0.6 } = opts;

  if (!(rawScale > 0)) return 0;
  if (!Number.isFinite(mouth) || !(comp > 0)) return rawScale;

  const m = Math.min(1, Math.max(0, mouth));

  // mouth=1 で factor=(1-comp)。行き過ぎ（負やゼロ）を floor で防ぐ。
  let factor = 1 - comp * m;
  const floor = 1 - maxReduction;
  if (factor < floor) factor = floor;

  return rawScale * factor;
}
