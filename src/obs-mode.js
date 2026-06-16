// camera.html を OBS の「ブラウザソース」として使うときの表示モードを URL から決める。
// ?obs=1     → ステージモード（背景透過＋UI 非表示。アバターだけのオーバーレイ）
// ?shadow=n  → アバターに影を付ける。n は 0~3 で大きいほど濃い（0=無し、値なしは 2）。
// パラメータ無しの通常ページは一切変更しない（普段使いの見た目を保つ）。

// 真偽フラグの許容表記。?obs（値なし）も有効にしたいので空文字を含める。
const TRUTHY = new Set(['', '1', 'true', 'yes', 'on']);

function flag(params, name) {
  if (!params.has(name)) return false;
  return TRUTHY.has((params.get(name) || '').toLowerCase());
}

// 影レベルの最大値。
const SHADOW_MAX = 3;

/**
 * ?shadow の値を影レベル（0~3 の整数）に変換する純関数。
 * 無し→0、値なし(?shadow)→2、数値→0~3 にクランプ、数値でなければ→0。
 * @param {string|null} raw params.get('shadow') の戻り
 * @returns {number}
 */
export function parseShadowLevel(raw) {
  if (raw == null) return 0;       // パラメータ無し
  if (raw === '') return 2;        // ?shadow（値なし）は既定レベル
  const n = Math.round(Number(raw));
  if (Number.isNaN(n)) return 0;   // 数値でなければ無効
  return Math.max(0, Math.min(SHADOW_MAX, n));
}

/**
 * URL の search 文字列（例: location.search）から OBS 表示モードを解析する純関数。
 * @param {string} [search] '?obs=1&shadow=2' / 'obs=1' / '' など。先頭の ? は任意。
 * @returns {{ obs: boolean, shadow: number }}
 */
export function parseObsParams(search = '') {
  const params = new URLSearchParams(search);
  return {
    obs: flag(params, 'obs'),
    shadow: parseShadowLevel(params.get('shadow')),
  };
}
