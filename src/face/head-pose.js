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
// biasYaw / biasPitch は「正面」とみなす中立オフセット（rad）。少し下や横を向いた
// 自然な姿勢を正面(0)として扱いたいときに、その姿勢の生角度を入れる。
//
// 上下左右で振り幅が違う（人は「上」より「下」を向きやすい等）ので、片側ごとに
// レンジを持てる: maxYawLeft/Right・maxPitchUp/Down。未指定(null)の側は対称な
// maxYaw / maxPitch にフォールバックする（後方互換）。方向ごとの「校正」はこの
// 片側レンジを書き換えて、振り切った姿勢がちょうど端(±1)に来るようにする。
export const DEFAULT_POSE_OPTIONS = {
  maxYaw: 0.5, // rad（約28度）で x=±1 に到達（左右共通のフォールバック）
  maxPitch: 0.4, // rad（約23度）で y=±1 に到達（上下共通のフォールバック）
  maxYawRight: null, // rad: 右に振り切る角。null なら maxYaw
  maxYawLeft: null, // rad: 左に振り切る角。null なら maxYaw
  maxPitchUp: null, // rad: 上に振り切る角。null なら maxPitch
  maxPitchDown: null, // rad: 下に振り切る角。null なら maxPitch
  biasYaw: 0, // rad: この左右角を正面(x=0)とみなす
  biasPitch: 0, // rad: この上下角を正面(y=0)とみなす
  invertX: false, // 左右が逆に感じたら true
  invertY: false, // 上下が逆に感じたら true
};

/**
 * 4x4 変換行列(列優先16要素)から正規化済みの向き {x, y} を返す。
 * x: -1(左) .. +1(右) / y: -1(上) .. +1(下)  ← 既存グリッド(r:上→下, c:左→右)に合わせた符号
 * roll は「首をかしげる」傾き(rad)。視線軸まわりの回転で、回転3x3の第1列
 * (右ベクトル m0, m1) の atan2 から求める。正規化はアプリ側に委ねて生値で返す。
 * @param {ArrayLike<number>} data 16要素の行列データ
 * @param {Partial<typeof DEFAULT_POSE_OPTIONS>} [options]
 * @returns {{ x: number, y: number, yaw: number, pitch: number, roll: number }}
 */
export function poseFromMatrix(data, options = {}) {
  const {
    maxYaw, maxPitch, maxYawRight, maxYawLeft, maxPitchUp, maxPitchDown,
    biasYaw, biasPitch, invertX, invertY,
  } = {
    ...DEFAULT_POSE_OPTIONS,
    ...options,
  };

  // 片側レンジ（未指定なら左右/上下共通の maxYaw / maxPitch にフォールバック）。
  // 0 や不正値で割ると NaN/Infinity が colX/rowY に伝播するので、極小値で底打ちする
  // （手書きの localStorage/テーマで 0 が入っても正規化が壊れないように）。
  const yawRight = (maxYawRight ?? maxYaw) || 1e-6;
  const yawLeft = (maxYawLeft ?? maxYaw) || 1e-6;
  const pitchUp = (maxPitchUp ?? maxPitch) || 1e-6;
  const pitchDown = (maxPitchDown ?? maxPitch) || 1e-6;

  // 前方ベクトル（回転3x3の第3列）
  const fwdX = data[8];
  const fwdY = data[9];
  const fwdZ = data[10];
  const depth = Math.abs(fwdZ) || 1e-6;

  // 生の角度（rad）。atan2 で前方ベクトルを水平/垂直成分に分解する。
  // yaw/pitch は「未補正の生値」として返す（キャリブレーション=正面設定に使う）。
  const yaw = Math.atan2(fwdX, depth); // 右を向くと符号が変わる
  const pitch = Math.atan2(fwdY, depth); // 上を向くと正（MediaPipe は y 上向き正）

  // バイアスを引いて中立(正面)をずらし、振った向きの側のレンジで正規化する。
  const dyaw = yaw - biasYaw;
  let x = dyaw >= 0 ? dyaw / yawRight : dyaw / yawLeft;
  // グリッドは r:0(上)→4(下) なので、上向き(pitch正)は y を負にする必要がある → 反転
  const dpitch = pitch - biasPitch;
  let y = dpitch >= 0 ? -(dpitch / pitchUp) : -(dpitch / pitchDown);

  if (invertX) x = -x;
  if (invertY) y = -y;

  // roll（首かしげ）: 視線軸まわりの回転。右ベクトル(第1列 m0,m1)の傾き。
  // 正面では (1,0,0) なので 0。首を右に傾けると右ベクトルが回り符号が変わる。
  const roll = Math.atan2(data[1], data[0]);

  return {
    x: clamp(x, -1, 1),
    y: clamp(y, -1, 1),
    yaw,
    pitch,
    roll,
  };
}
