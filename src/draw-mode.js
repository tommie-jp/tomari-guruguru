// index.html で「お絵かきオーバーレイ」を使うかを URL から決める純関数。
//   ?draw[=1]  → お絵かきを有効化（操作側=tx/local: ツールバー＋描画キャンバスを出す）
//   ?draw=0    → 明示的に無効（既定 ON を打ち消すデバッグ用）
//   無し        → 無効（従来どおり。描画レイヤーをマウントしないのでオーバーヘッド無し）
//
// rx(OBS の CEF)側は「描画データを受け取ったら常に表示する」ため、この旗とは独立に
// 受信ビューア（StaticCanvas）を出す（camera-app.jsx 側で mode を決める）。
// obs-mode.js / relay-mode.js と同じ「起動時に一度だけ解析する純関数」の流儀に揃える。

// 真偽フラグの許容表記。?draw（値なし）も有効にしたいので空文字を含める。
const TRUTHY = new Set(['', '1', 'true', 'yes', 'on']);

// 未指定は undefined、指定ありは真偽を返す三状態フラグ（obs-mode.js と同じ）。
function triState(params, name) {
  if (!params.has(name)) return undefined;
  return TRUTHY.has((params.get(name) || '').toLowerCase());
}

/**
 * URL の search 文字列（例: location.search）からお絵かきモードを解析する純関数。
 * @param {string} [search] '?draw=1' / 'draw=1' / '' など。先頭の ? は任意。
 * @returns {{ draw: (boolean|undefined) }} draw は未指定なら undefined。
 */
export function parseDrawParams(search = '') {
  const params = new URLSearchParams(search);
  return {
    draw: triState(params, 'draw'),
  };
}
