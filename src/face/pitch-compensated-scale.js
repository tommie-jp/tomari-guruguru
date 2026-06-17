// 顔の見かけサイズ(faceScale)を、ピッチ(上下の首振り)による foreshortening 分だけ
// 「正面相当」へ補正する純関数（副作用なし・テスト容易）。
//
// faceScale はバウンディングボックスの高さ（face-scale.js）。下/上を向くと顔の縦が
// カメラ平面上で前後に倒れて短く写り、距離が同じでもサイズが約 cos(pitch) 倍に縮む。
// そのままだと「下を向くとズームが小さくなる」症状になるので、1/cos(pitch) で戻す。
//
// comp(0..1) は効きの強さ。comp=1 で完全補正（正面と同じズーム）、comp=0 で無補正。
// 暴発防止に |pitch| を maxPitchRad でクランプし、倍率を maxFactor で頭打ちにする。

/**
 * @param {number} rawScale 生の見かけサイズ(0..1)。0以下なら0を返す
 * @param {number} pitch    ピッチ角(rad)。上下どちらも対称に補正する
 * @param {number} [comp=1] 補正の強さ(0..1)。0以下は無補正
 * @param {{ maxPitchRad?: number, maxFactor?: number }} [opts]
 * @returns {number} 補正後の見かけサイズ
 */
export function compensateScaleForPitch(rawScale, pitch, comp = 1, opts = {}) {
  const { maxPitchRad = 0.7, maxFactor = 1.8 } = opts;

  if (!(rawScale > 0)) return 0;
  if (!Number.isFinite(pitch) || !(comp > 0)) return rawScale;

  const clampedPitch = Math.min(Math.abs(pitch), maxPitchRad);
  const cos = Math.cos(clampedPitch);
  if (cos <= 0) return rawScale * maxFactor;

  // comp=0 で factor=1（無補正）, comp=1 で factor=1/cos（完全補正）の線形ブレンド。
  let factor = 1 + comp * (1 / cos - 1);
  if (factor < 1) factor = 1;
  if (factor > maxFactor) factor = maxFactor;

  return rawScale * factor;
}
