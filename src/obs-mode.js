// camera.html を OBS の「ブラウザソース」として使うときの表示モードを URL から決める。
// ?obs=1   → ステージモード（背景透過＋UI 非表示。アバターだけのオーバーレイ）
// ?shadow=1 → アバターに drop-shadow を付ける（賑やかな背景でも輪郭が立つ）
// パラメータ無しの通常ページは一切変更しない（普段使いの見た目を保つ）。

// 真偽フラグの許容表記。?obs（値なし）も有効にしたいので空文字を含める。
const TRUTHY = new Set(['', '1', 'true', 'yes', 'on']);

function flag(params, name) {
  if (!params.has(name)) return false;
  return TRUTHY.has((params.get(name) || '').toLowerCase());
}

/**
 * URL の search 文字列（例: location.search）から OBS 表示モードを解析する純関数。
 * @param {string} [search] '?obs=1&shadow=1' / 'obs=1' / '' など。先頭の ? は任意。
 * @returns {{ obs: boolean, shadow: boolean }}
 */
export function parseObsParams(search = '') {
  const params = new URLSearchParams(search);
  return {
    obs: flag(params, 'obs'),
    shadow: flag(params, 'shadow'),
  };
}
