// 顔の「立ち位置(posX/posY)」から、頭の回転(yaw/pitch)による見かけのズレを差し引く
// 純関数（副作用なし・テスト容易）。
//
// 立ち位置は鼻先ランドマークの座標から出している（face-position.js）。ところが頭を
// 回すと、平行移動していなくても鼻先がフレーム内で動くため、回転(向き)が平行移動(位置)
// の信号に混入する。例: 下を向くと鼻先が下に回り込み、アバターが下にズレる。
//
// normAngle は「ズレる向きに正規化した角度(rad)」を渡す:
//   上下: normAngleY = -pitch （下向きで正。pitch は上が正なので符号反転）
//   左右: normAngleX =  yaw   （右向きで正）
// posX/posY も「右が正・下が正」なので、normAngle を gain 倍して引けば回転成分を打ち消せる。
// invert は invertSlide(X)/invertSlideY(Y) と対応（rawPos が反転済みなら補正も反転する）。

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}

/**
 * @param {number} rawPos 生の立ち位置(-1..1)。非有限なら 0
 * @param {number} normAngle ズレ方向に正規化した角度(rad)
 * @param {number} gain 補正の強さ（rad あたりの位置補正量）。0以下は無補正
 * @param {{ invert?: boolean, maxAngleRad?: number }} [opts]
 * @returns {number} 補正後の立ち位置(-1..1)
 */
export function compensatePos(rawPos, normAngle, gain, opts = {}) {
  const { invert = false, maxAngleRad = 0.7 } = opts;

  if (!Number.isFinite(rawPos)) return 0;
  if (!(gain > 0) || !Number.isFinite(normAngle)) return clamp(rawPos, -1, 1);

  const a = clamp(normAngle, -maxAngleRad, maxAngleRad);
  const sign = invert ? -1 : 1;
  return clamp(rawPos - sign * gain * a, -1, 1);
}
