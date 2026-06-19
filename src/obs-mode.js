// index.html を OBS の「ブラウザソース」として使うときの表示モードを URL から決める。
// ?obs=1     → ステージモード（背景透過＋UI 非表示。アバターだけのオーバーレイ）
// ?obs=0     → ステージモードを明示的にオフ（rx の既定 ON を打ち消すデバッグ用）
// パラメータ無しの通常ページは一切変更しない（普段使いの見た目を保つ）。
//
// 影（旧 ?shadow=n）は Tweaks の「影の濃さ」(tweak `shadow`) に移行した。tx 側の値が
// sendConfig で rx(OBS) へ同期されるので、URL ではなくパネルで調整する。
//
// obs は「未指定(undefined) / true / false」の三状態で返す。呼び出し側が
// 「未指定なら rx のときだけ既定 ON」を決められるようにするため（rx 単独で透過）。

// 真偽フラグの許容表記。?obs（値なし）も有効にしたいので空文字を含める。
const TRUTHY = new Set(['', '1', 'true', 'yes', 'on']);

// 未指定は undefined、指定ありは真偽を返す三状態フラグ。
function triState(params, name) {
  if (!params.has(name)) return undefined;
  return TRUTHY.has((params.get(name) || '').toLowerCase());
}

/**
 * URL の search 文字列（例: location.search）から OBS 表示モードを解析する純関数。
 * @param {string} [search] '?obs=1' / 'obs=1' / '' など。先頭の ? は任意。
 * @returns {{ obs: (boolean|undefined) }} obs は未指定なら undefined。
 */
export function parseObsParams(search = '') {
  const params = new URLSearchParams(search);
  return {
    obs: triState(params, 'obs'),
  };
}
