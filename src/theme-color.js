// <meta name="theme-color"> を現在の背景色に追従させる（fork 追加）。Android Chrome の
// アドレスバー色や、ホーム画面追加（PWA 風）時のステータスバー色を背景 bgColor と揃える。
//
// 背景が transparent（OBS オーバーレイ）や空文字のときは無効値なので更新しない。HTML 側に
// 静的な theme-color を1つ置いておき、このモジュールが起動後に動的更新する二段構え。

/**
 * theme-color として meta に流し込んでよい色か判定する純関数。
 * @param {*} color CSS 色文字列を想定
 * @returns {boolean} 空でない文字列かつ transparent でなければ true
 */
export function isValidThemeColor(color) {
  return typeof color === 'string' && color.trim() !== '' && color.trim().toLowerCase() !== 'transparent';
}

/**
 * <meta name="theme-color"> の content を更新する（無ければ作る）。無効値なら何もしない。
 * @param {string} color 背景色（例 '#EEF4FB'）
 * @param {Document} [doc=document] 対象ドキュメント（テストではモックを渡す）
 * @returns {boolean} 更新したら true、無効値で見送ったら false
 */
export function applyThemeColor(color, doc = document) {
  if (!isValidThemeColor(color)) return false;
  let meta = doc.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = doc.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    doc.head.appendChild(meta);
  }
  meta.setAttribute('content', color);
  return true;
}
