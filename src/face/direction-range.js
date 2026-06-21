// 方向校正（上下左右）の純関数（副作用なし・テスト容易）。
//
// 各方向ボタンは「顔をその向きに振り切った姿勢」で押す。記録した姿勢が画面端
// (±1)に対応するよう、中立点(bias)からの振り角を感度込みで度へ換算して、その
// 向きの片側レンジ(rangeYaw{Left,Right}Deg / rangePitch{Up,Down}Deg)に書く値を返す。
//
// head-pose.js は maxYawRight = rangeYawRightDeg * DEG / 感度 として割るので、ここで
// 感度を掛けて記録すると往復で相殺し、「振り切り＝端」が校正した瞬間に厳密一致する
// （後から感度を上げれば全方向が一律に高感度化する＝感度の意味を保つ）。
//
// 符号規約は head-pose.js の正規化に合わせる: yaw は右が正 / pitch は上が正。
// 逆向き・振り不足（minDeg 未満）・不正入力は校正失敗として null を返す。

const DEG = Math.PI / 180;

// 各方向が「振り切ったときに増える生角度」の軸と符号、書き込み先キー。
//   right: yaw+ / left: yaw- / up: pitch+ / down: pitch-
const DIRECTIONS = {
  right: { axis: 'yaw', sign: 1, key: 'rangeYawRightDeg' },
  left: { axis: 'yaw', sign: -1, key: 'rangeYawLeftDeg' },
  up: { axis: 'pitch', sign: 1, key: 'rangePitchUpDeg' },
  down: { axis: 'pitch', sign: -1, key: 'rangePitchDownDeg' },
};

/**
 * @param {Object} p
 * @param {number} p.yawRad       今の生 yaw(rad, 右が正)
 * @param {number} p.pitchRad     今の生 pitch(rad, 上が正)
 * @param {number} p.biasYawDeg   正面バイアス 左右(度)
 * @param {number} p.biasPitchDeg 正面バイアス 上下(度)
 * @param {'up'|'down'|'left'|'right'} p.dir
 * @param {number} p.sensitivity  感度（>0）
 * @param {number} [p.minDeg=5]   校正に必要な最小振り角(度・物理角)
 * @returns {{ key: string, deg: number } | null} 不正・振り不足なら null
 */
export function computeDirectionRange({
  yawRad, pitchRad, biasYawDeg, biasPitchDeg, dir, sensitivity, minDeg = 5,
}) {
  const spec = DIRECTIONS[dir];
  if (!spec) return null;
  if (!Number.isFinite(sensitivity) || sensitivity <= 0) return null;

  const poseRad = spec.axis === 'yaw' ? yawRad : pitchRad;
  const biasDeg = spec.axis === 'yaw' ? biasYawDeg : biasPitchDeg;
  if (!Number.isFinite(poseRad) || !Number.isFinite(biasDeg)) return null;

  // 中立点からの振り角を、その向きが正になる符号で取る（物理角・度）。
  const swingDeg = ((poseRad - biasDeg * DEG) / DEG) * spec.sign;

  // 逆向き（負）・振り不足（minDeg 未満）は校正失敗。
  if (!(swingDeg >= minDeg)) return null;

  // floor で切り捨て、レンジを「振り角ちょうど以下」にする。こうすると校正した姿勢で
  // x(または y) が必ず ±1 以上（クランプで端）に届く＝デバッグ表示が確実に 1.00 になる。
  // round だと端数の丸め上げで maxYaw が大きくなり、振り切っても 0.99 止まりになり得る。
  // 1e-6 は浮動小数の誤差（例: 20° が 19.9999… になり floor で 19 へ落ちる）を吸収する分。
  return { key: spec.key, deg: Math.floor(swingDeg * sensitivity + 1e-6) };
}
