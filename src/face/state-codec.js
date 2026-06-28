// 状態フレーム ⇔ コンパクトな数値配列（WS で送る最小ペイロード）。
//
// docs-camera/11 の方針どおり、まずは「順序固定のコンパクト JSON 配列」で始める
// （LAN なら帯域は誤差、デバッグも容易）。将来バイナリ化(int8/uint8)する場合も、
// 送受信側はこの encode/decode だけ差し替えればよい＝ここが唯一の境界。
//
// 配列の並び（固定）:
//   [faceDetected(0/1), colX, rowY, tilt, slideX, slideY, zoom, sheet,
//    userX, userY, userZoom]
// blendshapes と yaw/pitch は送らない（受信側は使わない＝サイズ削減の本丸）。
// userX/userY(vw/vh) と userZoom はユーザーがドラッグ移動・ズームした「表示上の」
// 調整。後ろに追記したので旧8要素フレームも既定値(0,0,1)で復元できる（後方互換）。

// 桁を丸めて JSON を小さくする。平滑化が後段に入るので 0.001 刻みで十分。
function r3(n) {
  return Math.round(n * 1000) / 1000;
}

/**
 * @param {import('./avatar-state').StateFrame} f
 * @returns {Array<number>} WS 送信用の配列（JSON.stringify して送る）
 */
export function encodeStateFrame(f) {
  return [
    f.faceDetected ? 1 : 0,
    r3(f.colX),
    r3(f.rowY),
    r3(f.tilt),
    r3(f.slideX),
    r3(f.slideY),
    r3(f.zoom),
    f.sheet | 0,
    r3(f.userX || 0),
    r3(f.userY || 0),
    r3(f.userZoom == null ? 1 : f.userZoom),
  ];
}

/**
 * @param {Array<number>} a encodeStateFrame の戻り（JSON.parse 済み）
 * @returns {import('./avatar-state').StateFrame}
 */
export function decodeStateFrame(a) {
  return {
    faceDetected: a[0] === 1,
    colX: a[1],
    rowY: a[2],
    tilt: a[3],
    slideX: a[4],
    slideY: a[5],
    zoom: a[6],
    sheet: a[7] | 0,
    userX: a[8] ?? 0,
    userY: a[9] ?? 0,
    userZoom: a[10] ?? 1,
  };
}
