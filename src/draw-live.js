// お絵かきライブストローク（draw-live）の純ヘルパー。
//
// tx は描画中のポイント列を間引いて rx へ流し、rx は一時 Path でプレビューを描く
// （確定 draw-scene が来たら本物に置換）。ここは fabric 非依存の検証・整形だけを担い、
// 無認証 WS 越しの受信値を安全側に丸める（偽注入・暴走対策）。fabric/React 部分と分離して
// ユニットテストできるようにする。
//
// 関連: src/draw-layer.jsx（tx フック・rx setLive）、src/face/relay-client.js（draw-live 送受信）。

export const MAX_LIVE_PTS = 2000;      // 1ストローク内のポイント上限（超過分は捨てる）
export const LIVE_COORD_MAX = 100000;  // 受理する座標の絶対値上限（NaN/∞/異常値を弾く）
export const DEFAULT_LIVE_COLOR = '#ff3b30';

const HEX6_RE = /^#[0-9a-fA-F]{6}$/;

// -0 を 0 に正規化して丸める（JSON 上は同じだが厳密比較・等価判定を安定させる）。
function roundCoord(v) {
  const n = Math.round(v);
  return n === 0 ? 0 : n;
}

// 1点を [x,y] 整数に整形する。非配列・要素不足・非有限・範囲外は null。
export function sanitizeLivePoint(p) {
  if (!Array.isArray(p) || p.length < 2) return null;
  const x = Number(p[0]);
  const y = Number(p[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (Math.abs(x) > LIVE_COORD_MAX || Math.abs(y) > LIVE_COORD_MAX) return null;
  return [roundCoord(x), roundCoord(y)];
}

// 点列を整形する。壊れた点は捨て、最大 max 点まで（暴走/偽注入防御）。
export function sanitizeLivePoints(pts, max = MAX_LIVE_PTS) {
  if (!Array.isArray(pts)) return [];
  const out = [];
  for (const p of pts) {
    const q = sanitizeLivePoint(p);
    if (q) out.push(q);
    if (out.length >= max) break;
  }
  return out;
}

// プレビューを描けるか。getSmoothPathFromPoints は複数点前提（1点だと縮退パス）なので
// 2点未満は描かない＝最初の move で線が出る（start の1点では描かない）。
export function isRenderablePts(pts) {
  return Array.isArray(pts) && pts.length >= 2;
}

// ライブ線の太さを安全側にクランプする（受信値が壊れていても破綻しない）。
export function clampLiveWidth(w) {
  const n = Number(w);
  if (!Number.isFinite(n)) return 1;
  return Math.min(64, Math.max(1, n));
}

// ライブ線の色。#rrggbb 形式のみ受理し、それ以外は既定色（CSS インジェクション防止）。
export function sanitizeLiveColor(c, fallback = DEFAULT_LIVE_COLOR) {
  return (typeof c === 'string' && HEX6_RE.test(c)) ? c : fallback;
}
