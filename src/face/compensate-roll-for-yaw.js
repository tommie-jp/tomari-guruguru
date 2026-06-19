// 首かしげ(roll)から、左右の向き(yaw)による見かけのかしげを差し引く純関数
// （副作用なし・テスト容易）。
//
// roll は目のランドマーク等から推定するため、頭を左右に回す(yaw)と遠近・3D の影響で
// 実際にはかしげていなくても roll が混入し、アバターが首をかしげてしまう。混入量は
// yaw にほぼ比例する奇関数（右で一方向・左で逆方向）なので、yaw を comp 倍して引けば
// 左右どちらの向きでも対称に打ち消せる。compensatePos（位置の yaw/pitch 補正）の roll 版。
//
// comp は補正の強さ（yaw[rad] あたり差し引く roll[rad]）。混入の向きは推定モデル依存で
// 一意に決められないため符号付き（負も可）。0 で無補正（従来挙動）。暴発防止に yaw を
// maxYawRad でクランプする。

/**
 * @param {number} roll      生のかしげ角(rad)。非有限なら 0
 * @param {number} yaw       左右の向き(rad, 右が正)
 * @param {number} [comp=0]  補正の強さ（符号付き）。0/非有限は無補正
 * @param {{ maxYawRad?: number }} [opts]
 * @returns {number} 補正後のかしげ角(rad)
 */
export function compensateRollForYaw(roll, yaw, comp = 0, opts = {}) {
  const { maxYawRad = 0.7 } = opts;

  if (!Number.isFinite(roll)) return 0;
  if (comp === 0 || !Number.isFinite(comp) || !Number.isFinite(yaw)) return roll;

  const y = Math.min(maxYawRad, Math.max(-maxYawRad, yaw));
  return roll - comp * y;
}
