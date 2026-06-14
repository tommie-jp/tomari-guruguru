// 顔の「立ち位置（水平・垂直の平行移動）」を取り出す純関数（副作用なし・テスト容易）。
//
// MediaPipe FaceLandmarker の faceLandmarks[0] は画像内の正規化座標(0..1)。
// 鼻先(index 1)の x/y を見れば「フレーム内で顔が左右・上下どこに居るか」が分かる。
// 頭の「向き(yaw/pitch=回転)」とは独立した信号で、顔ごとスライドした量を表す。
//
// 行列の平行移動列 data[12]/data[13] でも取れるが、カメラ距離でスケールが変わり
// 扱いにくい。ランドマークの正規化座標なら 0..1 で安定するためこちらを採用。

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}

// 鼻先ランドマークのインデックス（MediaPipe Face Landmarker の規約）。
const NOSE_TIP_INDEX = 1;

// maxShift(X)/maxShiftY(Y): 中央(0.5)からこれだけズレると ±1 に到達する。小さいほど高感度。
// 縦は可動が狭めなので既定をやや小さく。
// invertX/invertY: 鏡像表示や好みに合わせて向きを反転する。
export const DEFAULT_POSITION_OPTIONS = {
  maxShift: 0.25,
  maxShiftY: 0.2,
  invertX: false,
  invertY: false,
};

/**
 * ランドマーク配列から正規化済みの位置 {x, y} を返す。
 * x: -1(画面左) .. +1(画面右) / y: -1(画面上) .. +1(画面下)。鼻が中央なら 0。
 * @param {Array<{x: number, y: number}>|undefined} landmarks faceLandmarks[0]
 * @param {Partial<typeof DEFAULT_POSITION_OPTIONS>} [options]
 * @returns {{ x: number, y: number }}
 */
export function facePositionFromLandmarks(landmarks, options = {}) {
  const { maxShift, maxShiftY, invertX, invertY } = { ...DEFAULT_POSITION_OPTIONS, ...options };

  const nose = landmarks && landmarks[NOSE_TIP_INDEX];
  if (!nose || typeof nose.x !== 'number') return { x: 0, y: 0 };

  let x = (nose.x - 0.5) / maxShift;
  // 正規化 y は上が 0・下が 1。CSS の上=負に合わせ、そのまま (y-0.5) を使う
  // （上に動く=nose.y 小=負）。invertY で反転可能。
  let y = typeof nose.y === 'number' ? (nose.y - 0.5) / maxShiftY : 0;
  if (invertX) x = -x;
  if (invertY) y = -y;

  return { x: clamp(x, -1, 1), y: clamp(y, -1, 1) };
}
