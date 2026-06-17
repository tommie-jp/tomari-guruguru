// 「状態フレーム」+ 平滑化係数 → 表示する画像(cell/sheet)と transform を作る純ロジック。
//
// docs-camera/05 の構成で consumer(OBS の CEF) 側が毎フレーム実行する。連続値はここで
// 時間平滑化する＝受信が不定間隔・低レートでも CEF 自前の rAF(60Hz) で最新ターゲットへ
// lerp するので、ネットワークのジッタを吸収してぬるぬる動く。ローカル版も同じ経路を通す
// ことで producer/consumer/ローカルの式が一本化され、ドリフトしない。
import charConfig from '../character-config';

const { rows: ROWS, cols: COLS } = charConfig;

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}

/**
 * 平滑化エンベロープの保持先。consumer 側で1つ保持し、applyState に毎フレーム渡す。
 */
export function createSmoothState() {
  return {
    x: 0,      // 向き(列)の平滑化（-1..1）
    y: 0,      // 向き(行)の平滑化（-1..1）
    tilt: 0,   // 首かしげ(deg)
    slideX: 0, // 左右スライド(vw)
    slideY: 0, // 上下スライド(vh)
    zoom: 1,   // ズーム率（初期=等倍）
  };
}

/**
 * @typedef {Object} AppliedState
 * @property {{ r: number, c: number }} cell 表示するグリッドセル
 * @property {number} sheet シート番号(0..5)
 * @property {string} motionTransform motionRef へ書く transform（translate+rotate）
 * @property {string} zoomTransform zoomRef へ書く transform（scale）
 */

/**
 * @param {import('./avatar-state').StateFrame} frame 受信した状態フレーム
 * @param {{ smoothing: number, motionSmoothing: number }} t 平滑化係数（config 由来）
 * @param {ReturnType<typeof createSmoothState>} sm 平滑化状態（この関数が更新する）
 * @returns {AppliedState}
 */
export function applyState(frame, t, sm) {
  // 向き: 最新ターゲット(colX/rowY)へ lerp。producer はロスト時も最後の値を据え置いて
  // 送るので、ここでは常に同じ式でよい（ロスト時は実質フリーズする）。
  sm.x += (frame.colX - sm.x) * t.smoothing;
  sm.y += (frame.rowY - sm.y) * t.smoothing;
  const c = clamp(Math.round(((sm.x + 1) / 2) * (COLS - 1)), 0, COLS - 1);
  const r = clamp(Math.round(((sm.y + 1) / 2) * (ROWS - 1)), 0, ROWS - 1);

  // 首かしげ・スライド・ズームも motionSmoothing で lerp。
  sm.tilt += (frame.tilt - sm.tilt) * t.motionSmoothing;
  sm.slideX += (frame.slideX - sm.slideX) * t.motionSmoothing;
  sm.slideY += (frame.slideY - sm.slideY) * t.motionSmoothing;
  sm.zoom += (frame.zoom - sm.zoom) * t.motionSmoothing;

  return {
    cell: { r, c },
    sheet: frame.sheet,
    motionTransform: `translateX(${sm.slideX.toFixed(2)}vw) translateY(${sm.slideY.toFixed(2)}vh) rotate(${sm.tilt.toFixed(2)}deg)`,
    zoomTransform: `scale(${sm.zoom.toFixed(3)})`,
  };
}
