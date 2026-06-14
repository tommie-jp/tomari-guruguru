// 顔の「見かけの大きさ」を取り出す純関数（副作用なし・テスト容易）。
//
// カメラに近いほど顔は大きく写る。見かけサイズ ∝ 1/距離 なので、
// あるフレームのサイズと「基準サイズ」の比をとれば、それがそのままズーム率になる。
// （比をとるため絶対単位やカメラ FOV に依存しないのが利点。基準はアプリ側で較正する）
//
// 指標は faceLandmarks[0] 全点のバウンディングボックス高さ(maxY-minY)。
// 横幅は yaw(左右の首振り)で縮みやすいため、比較的安定な縦の高さを採用する。
// 縦も pitch で多少変わるが、距離変化のほうが支配的なので実用上は十分。

/**
 * ランドマーク群の見かけサイズ（バウンディングボックス高さ, 0..1）を返す。
 * @param {Array<{x: number, y: number}>|undefined} landmarks faceLandmarks[0]
 * @returns {number} 0..1（顔が見つからなければ 0）
 */
export function faceScaleFromLandmarks(landmarks) {
  if (!landmarks || landmarks.length === 0) return 0;

  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of landmarks) {
    if (!p || typeof p.y !== 'number') continue;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  if (!isFinite(minY) || !isFinite(maxY)) return 0;

  return maxY - minY;
}
