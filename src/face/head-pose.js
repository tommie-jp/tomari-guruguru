// 顔向き推定 — 純関数モジュール（副作用なし・テスト容易）
//
// MediaPipe Face Landmarker の facialTransformationMatrixes[0].data から
// 頭部の向き(yaw/pitch)を取り出し、アバターの追従系が使う -1..1 の {x, y} に正規化する。
//
// 入力の data は 4x4 同次変換行列で、MediaPipe の規約により「列優先(column-major)」。
//   | m0  m4  m8   m12 |
//   | m1  m5  m9   m13 |
//   | m2  m6  m10  m14 |
//   | m3  m7  m11  m15 |
// 回転3x3の第3列 (m8, m9, m10) が「顔が向いている前方ベクトル」になる。
// 正面のときは概ね (0, 0, ±1)。横を向くと x が、上下を向くと y が増減する。

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}

// 既定の調整パラメータ。向きが逆なら invertX / invertY を反転、
// 反応の強さは maxYaw / maxPitch（小さいほど少しの動きで端に届く=高感度）で調整。
export const DEFAULT_POSE_OPTIONS = {
  maxYaw: 0.5, // rad（約28度）で x=±1 に到達
  maxPitch: 0.4, // rad（約23度）で y=±1 に到達
  invertX: false, // 左右が逆に感じたら true
  invertY: false, // 上下が逆に感じたら true
};

/**
 * 4x4 変換行列(列優先16要素)から正規化済みの向き {x, y} を返す。
 * x: -1(左) .. +1(右) / y: -1(上) .. +1(下)  ← 既存グリッド(r:上→下, c:左→右)に合わせた符号
 * @param {ArrayLike<number>} data 16要素の行列データ
 * @param {Partial<typeof DEFAULT_POSE_OPTIONS>} [options]
 * @returns {{ x: number, y: number, yaw: number, pitch: number }}
 */
export function poseFromMatrix(data, options = {}) {
  const { maxYaw, maxPitch, invertX, invertY } = { ...DEFAULT_POSE_OPTIONS, ...options };

  // 前方ベクトル（回転3x3の第3列）
  const fwdX = data[8];
  const fwdY = data[9];
  const fwdZ = data[10];
  const depth = Math.abs(fwdZ) || 1e-6;

  // 角度（rad）。atan2 で前方ベクトルを水平/垂直成分に分解する。
  const yaw = Math.atan2(fwdX, depth); // 右を向くと符号が変わる
  const pitch = Math.atan2(fwdY, depth); // 上を向くと正（MediaPipe は y 上向き正）

  let x = yaw / maxYaw;
  // グリッドは r:0(上)→4(下) なので、上向き(pitch正)は y を負にする必要がある → 反転
  let y = -pitch / maxPitch;

  if (invertX) x = -x;
  if (invertY) y = -y;

  return {
    x: clamp(x, -1, 1),
    y: clamp(y, -1, 1),
    yaw,
    pitch,
  };
}
