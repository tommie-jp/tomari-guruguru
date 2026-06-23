// 首かしげ(roll)から、左右の向き(yaw)による見かけのかしげを差し引く純関数
// （副作用なし・テスト容易）。
//
// roll は顔の回転行列の右ベクトル(第1列)の傾き atan2(m1, m0) から推定する。頭を左右に
// 回す(yaw)だけなら幾何的には roll=0 だが、人は少し上下を向いた(pitch)姿勢で振り向くため、
// 内的回転 R=Rx(pitch)·Ry(yaw) の右ベクトルが傾き、実際にはかしげていなくても roll が
// 混入する。その混入量は厳密に
//   roll_mix = atan2(sin(pitch)·sin(yaw), cos(yaw))     （rollYawPitchBasis）
// で、pitch=0 では 0・yaw の奇関数（左右対称）という性質を持つ。旧版は roll≈comp·yaw と
// yaw 単独の線形で近似していたため、校正時と違う pitch で振り向くと大きな残差が出ていた。
//
// comp は混入の「結合係数」（基底 1 あたり差し引く roll）。理想（内的回転＋忠実な推定）なら
// comp≈1 だが、首振りの回し方や推定の癖で実効値は変わるため符号付きの可変値にする。0 で
// 無補正（従来挙動）。暴発防止に yaw/pitch を maxAngleRad でクランプする。

const MAX_ANGLE_RAD = 1.4; // 約80°。校正で振り切っても（~60°）クランプに掛からない広さ。
// atan2 の分母 cos(yaw) が 0 に近づく ±π/2 手前で頭打ちし、分岐の飛び（不連続）を避ける。

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}

/**
 * yaw×pitch 由来の見かけのかしげ(roll)の基底。校正(computeTiltYawComp)と実行時で
 * 同じ式を使うことで、校正姿勢で残差が厳密に 0 になる。
 * @param {number} yaw   左右の向き(rad, 右が正)
 * @param {number} pitch 上下の向き(rad, 上が正)
 * @param {number} [maxAngleRad=MAX_ANGLE_RAD] クランプ角
 * @returns {number} 見かけのかしげ角(rad)。pitch=0 または yaw=0 で 0
 */
export function rollYawPitchBasis(yaw, pitch, maxAngleRad = MAX_ANGLE_RAD) {
  const y = clamp(yaw, -maxAngleRad, maxAngleRad);
  const p = clamp(pitch, -maxAngleRad, maxAngleRad);
  return Math.atan2(Math.sin(p) * Math.sin(y), Math.cos(y));
}

/**
 * @param {number} roll      生のかしげ角(rad)。非有限なら 0
 * @param {number} yaw       左右の向き(rad, 右が正)
 * @param {number} [comp=0]  結合係数（符号付き）。0/非有限は無補正
 * @param {number} [pitch=0] 上下の向き(rad, 上が正)。0 や非有限なら混入なし=無補正
 * @param {{ maxAngleRad?: number }} [opts]
 * @returns {number} 補正後のかしげ角(rad)
 */
export function compensateRollForYaw(roll, yaw, comp = 0, pitch = 0, opts = {}) {
  const { maxAngleRad = MAX_ANGLE_RAD } = opts;

  if (!Number.isFinite(roll)) return 0;
  if (comp === 0 || !Number.isFinite(comp) || !Number.isFinite(yaw) || !Number.isFinite(pitch)) {
    return roll;
  }

  return roll - comp * rollYawPitchBasis(yaw, pitch, maxAngleRad);
}
