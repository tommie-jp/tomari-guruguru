// 左右を向いたときのかしげ補正（a/b モデル）の実行時関数（純関数・副作用なし・テスト容易）。
//
// ユーザー指定のモデル:
//   a … 正面のかしげ（正ボタンで記録 = biasRollDeg）。全姿勢から差し引く中立。
//   b … 左右のかしげ差（右/左ボタンで記録 = rollYawTiltB）。a を引いた後の、右を向いたときの
//       見かけのかしげ。右を向いたら roll-a-b、左を向いたら roll-a+b、正面は roll-a。
//
// この関数は b 由来の差し引き量(deg)だけを返す（a の差し引きは呼び出し側 avatar-state が biasRollDeg で行う）。
// 向きは「正面相対の yaw」(yawRel = 生yaw − biasYaw)の符号で決める: 右(yawRel>0)で +b、左(yawRel<0)で −b。
// 純粋な符号(sign)だと正面付近で b が跳ねて平滑化がジッターを追うので、±knee の範囲だけ線形に
// ランプして滑らかに 0 へ繋ぐ（knee 以上振れば満額 b ＝「右/左を向いたら roll-a∓b」の端点は不変）。
// knee は方向校正の最小振り角(5°)に合わせる: 校正は 5°以上でしか効かないので、押した姿勢では常に満額 b。

const DEG = Math.PI / 180;
const DIR_KNEE_RAD = 5 * DEG; // 正面相対 yaw がこの角度以上なら満額 b（未満は線形ランプ）。

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}

/**
 * b 由来の差し引きかしげ(deg)。右(yawRel>0)で +bDeg、左(yawRel<0)で −bDeg、正面で 0。
 * ±kneeRad の内側は線形ランプ（段差防止）、外側は満額 ±bDeg で頭打ち。
 * @param {number} yawRel 正面相対の yaw(rad, 右が正 = 生yaw − biasYaw)
 * @param {number} bDeg   左右のかしげ差(deg, rollYawTiltB)。0／非有限は 0（補正なし）
 * @param {{ kneeRad?: number }} [opts]
 * @returns {number} 差し引くかしげ(deg)。非有限な yawRel・bDeg 0 は 0
 */
export function yawTiltBiasDeg(yawRel, bDeg, { kneeRad = DIR_KNEE_RAD } = {}) {
  if (!Number.isFinite(yawRel) || !Number.isFinite(bDeg) || bDeg === 0) return 0;
  const dir = clamp(yawRel / kneeRad, -1, 1); // 右+1/左-1、正面付近は線形
  return bDeg * dir;
}
