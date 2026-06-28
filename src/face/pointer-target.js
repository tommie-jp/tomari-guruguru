// ポインタ座標 → アバター向きターゲット(-1..1) の純関数（DOM 非依存・テスト容易）。
//
// マウス追従の中核。app.jsx / talk-app.jsx に重複していた
//   cx = rect.left + width/2, cy = rect.top + height*0.45,
//   x = clamp((clientX - cx)/range, -1, 1)
// を一本化する（DRY）。アバター中心からのカーソルずれを followRange で正規化して
// -1..1 に丸め、顔追従と同じ target.{x,y} 契約へ載せる（描画側は出どころを問わない）。
//
// cy が height*0.45（中心より少し上）なのは、顔の位置がスプライト中心より上にあるため。
// invertX/invertY は左右・上下の反転（顔追従の鏡像補正と同じ意味）。マウス追従の既定は
// 反転なし（カーソルの方向へそのまま振り向く）。

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}

/**
 * @param {number} clientX ポインタ X（viewport 座標, px）
 * @param {number} clientY ポインタ Y（viewport 座標, px）
 * @param {{ left: number, top: number, width: number, height: number }} rect アンカー要素の矩形
 * @param {number} range 追従範囲（px）。ここで ±1 に達する。
 * @param {{ invertX?: boolean, invertY?: boolean }} [opts]
 * @returns {{ x: number, y: number }} -1..1 にクランプした向きターゲット
 */
export function pointerToTarget(clientX, clientY, rect, range, { invertX = false, invertY = false } = {}) {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height * 0.45;
  const x = clamp((clientX - cx) / range, -1, 1) * (invertX ? -1 : 1);
  const y = clamp((clientY - cy) / range, -1, 1) * (invertY ? -1 : 1);
  return { x, y };
}
