// スタンプ（リアクション表示）の配置算出。フレームワーク非依存・純関数・DOM 非依存。
//
// cue-stamp.jsx（毎フレームの placeNode）と cue-offset-editor.jsx（ドラッグ量 → em 換算）が
// 共用する。ここに切り出すことで (1) 配置式の単一情報源（DRY）、(2) DOM 無しで単体テスト可能、
// (3) cue-stamp.jsx をコンポーネントだけの export に保てる（react-refresh 警告回避）。
//
// 単位の方針: スタンプの文字サイズ fontSize はアバター幅に比例（= 幅比）。位置オフセット ox/oy も
// 「fontSize 何個ぶん」= em で表すので、charSize 変更・ズーム・画面回転・解像度差に対してスケール
// 不変になる（placeNode が毎フレーム getBoundingClientRect().width を読み直すため）。

// 位置算出パラメータ（アバター rect に対する割合）。cue-stamp.jsx の旧定数を移設。
export const OVER_SIZE = 0.34;    // 'over' の文字サイズ＝アバター幅 × これ
export const ABOVE_SIZE = 0.17;   // 'above' の文字サイズ＝アバター幅 × これ
export const HEAD_CENTER_Y = 0.30; // 'over' を乗せる頭の縦位置（ボックス上端からの割合）

// 文字サイズ（px）。place で係数を切り替える。未知 place は over 扱い。
export function stampFontSize(width, place) {
  return width * (place === 'above' ? ABOVE_SIZE : OVER_SIZE);
}

// アバター矩形 rect（{left, top, width, height}）から、スタンプ要素の left/top/fontSize を算出する。
//   place … 'above'（頭の上）/ 'over'（頭にオーバーレイ）。既定 over。
//   jit   … 連打時に重ならないための左右ジッター（em 単位、fontSize 倍で効く）。
//   ox/oy … cue 毎のユーザー調整オフセット（em 単位）。既定 {0,0} は従来表示と完全一致。
// jit と ox はどちらも横方向の em なので加算する。
export function computeStampBox(rect, opts) {
  const { place = 'over', jit = 0, ox = 0, oy = 0 } = opts || {};
  const above = place === 'above';
  const fontSize = stampFontSize(rect.width, place);
  const cx = rect.left + rect.width / 2;
  // above: 文字の下端がアバター上端に来るよう top = 上端 - 文字高。
  // over : 頭の縦位置に中心が来るよう top = 中心 - 文字高/2。
  const topY = above
    ? rect.top - fontSize
    : rect.top + rect.height * HEAD_CENTER_Y - fontSize / 2;
  return {
    fontSize,
    left: cx + (jit + ox) * fontSize,
    top: topY + oy * fontSize,
  };
}
