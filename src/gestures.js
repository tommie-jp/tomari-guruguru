// ジェスチャー（エモート演出）の共有ロジック。フレームワーク非依存・純関数・依存ゼロ。
//
// app.jsx（ぐるぐる）/ talk-app.jsx（トーク）が import して使う。各アプリは
// 「再生中ジェスチャー」を useRef に持ち、毎フレーム sampleGesture() を呼んで
//   - cell   … 表示するセル {r,c}（入力由来の向きを一時上書き）
//   - rotate … 面内回転(deg)。回転(spin)演出だけが使う＝「かしげ」と同じ平面のCSS rotate
//   - scale  … 拡縮（軽いスクッシュ）。1.0 で等倍
// を取り出して描画へ反映する。再生終了で sampleGesture() は null を返し、呼び側は
// 上書きを解除してライブ追従へ戻す。平滑化ターゲットは裏で回り続けているので、
// 解除と同時にぬるっとライブ方向へ収束する（スナップしない）。
//
// 演出種別:
//   spin  … 回転。要素ごと面内 1 回転（予備動作→主動作→オーバーシュート）。
//           背面ビューが無いのでフレームは正面 r2c2 固定にし、絵を CSS で回す。
//   nod   … うなずき(Yes)。行(縦)だけ動かす。下げる前に軽く上フリック。
//   shake … いやいや(No)。列(横)だけ左右に振る＋減衰。
//
// キーフレーム { t, r, c, dr, dc, rotate, scale, ease }:
//   t      … 開始からの経過 ms
//   r,c    … 絶対セル(0..4)。指定時は base を無視
//   dr,dc  … base（再生開始時のライブセル）からの相対オフセット（r,c 未指定時に使用）
//   rotate … 面内回転(deg)。省略時 0
//   scale  … 拡縮。省略時 1
//   ease   … 「直前キー→このキー」区間のイージング名（EASES のキー）。省略時 linear

const GRID_DEFAULT = { rows: 5, cols: 5 };

export const EASES = {
  linear: (p) => p,
  easeOut: (p) => 1 - (1 - p) * (1 - p),
  easeIn: (p) => p * p,
  easeInOut: (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2),
  // 末尾で行き過ぎてから戻る（オーバーシュート）。
  easeOutBack: (p) => {
    const s = 1.70158;
    const q = p - 1;
    return 1 + (s + 1) * q * q * q + s * q * q;
  },
};

export const GESTURES = {
  // 回転（spin）— total 980ms。正面 r2c2 固定で要素ごと面内 1 回転。
  spin: {
    total: 980,
    keys: [
      { t: 0,   r: 2, c: 2, rotate: 0,   scale: 1.0 },
      { t: 130, r: 2, c: 2, rotate: -18, scale: 1.0,  ease: 'easeOut' },     // 予備動作（逆へ溜め）
      { t: 250, r: 2, c: 2, rotate: 40,  scale: 0.94, ease: 'easeIn' },      // 回り出し＋軽くスクッシュ
      { t: 700, r: 2, c: 2, rotate: 330, scale: 1.0,  ease: 'easeOut' },     // 一気に回る
      { t: 850, r: 2, c: 2, rotate: 374, scale: 1.06, ease: 'easeOut' },     // オーバーシュート＋伸び
      { t: 980, r: 2, c: 2, rotate: 360, scale: 1.0,  ease: 'easeInOut' },   // 12時で着地→解放
    ],
  },
  // うなずき（nod / Yes）— total 620ms。列は base 固定、行だけ動かす。
  nod: {
    total: 620,
    keys: [
      { t: 0,   dr: 0,  dc: 0 },
      { t: 90,  dr: -1, dc: 0, ease: 'easeOut' },     // 上フリック（反動の溜め）
      { t: 260, dr: 2,  dc: 0, ease: 'easeInOut' },   // しっかり下げる（うなずき本体）
      { t: 420, dr: 0,  dc: 0, ease: 'easeOutBack' }, // 戻し＋軽くオーバーシュート
      { t: 540, dr: 1,  dc: 0, ease: 'easeInOut' },   // 小さな2度目の沈み（余韻）
      { t: 620, dr: 0,  dc: 0, ease: 'easeInOut' },   // 着地→解放
    ],
  },
  // No（首振り / head-shake）— total 700ms。行は base 固定、列だけ左右に振る＋減衰。
  shake: {
    total: 700,
    keys: [
      { t: 0,   dr: 0, dc: 0 },
      { t: 110, dr: 0, dc: -2, ease: 'easeInOut' },   // 左（強め）
      { t: 280, dr: 0, dc: 2,  ease: 'easeInOut' },   // 右（強め）
      { t: 440, dr: 0, dc: -1, ease: 'easeInOut' },   // 左（減衰）
      { t: 580, dr: 0, dc: 1,  ease: 'easeInOut' },   // 右（減衰）
      { t: 700, dr: 0, dc: 0,  ease: 'easeInOut' },   // 中央着地→解放
    ],
  },
};

function clampInt(v, lo, hi) {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

function lerp(a, b, p) {
  return a + (b - a) * p;
}

// キーフレームの絶対セルを解決する。r/c 指定はそのまま、無ければ base + dr/dc。
function cellAt(k, base, grid) {
  const r = k.r != null ? k.r : base.r + (k.dr || 0);
  const c = k.c != null ? k.c : base.c + (k.dc || 0);
  return {
    r: clampInt(r, 0, grid.rows - 1),
    c: clampInt(c, 0, grid.cols - 1),
  };
}

// elapsed をはさむ2キー(a,b)を探す。a=直前以前で最も後ろ、b=以降で最も前。
function bracket(keys, elapsed) {
  let a = keys[0];
  let b = keys[0];
  for (let i = 0; i < keys.length; i++) {
    if (keys[i].t <= elapsed) a = keys[i];
    if (keys[i].t >= elapsed) { b = keys[i]; break; }
  }
  return { a, b };
}

// 再生中ジェスチャーの「いまのフレーム」を返す純関数。
//   gesture … GESTURES の1要素
//   elapsed … 再生開始からの経過 ms
//   base    … 再生開始時のライブセル {r,c}（相対キーの基準）
//   grid    … { rows, cols }（既定 5x5）
// 戻り値: { cell:{r,c}, rotate, scale } / 終了後は null（解放の合図）。
export function sampleGesture(gesture, elapsed, base, grid = GRID_DEFAULT) {
  if (!gesture || elapsed >= gesture.total) return null;
  const e0 = Math.max(0, elapsed);
  const { a, b } = bracket(gesture.keys, e0);
  const span = Math.max(1, b.t - a.t);
  const p = Math.max(0, Math.min(1, (e0 - a.t) / span));
  const ease = EASES[b.ease] || EASES.linear;
  const e = ease(p);

  const ca = cellAt(a, base, grid);
  const cb = cellAt(b, base, grid);
  const cell = {
    r: clampInt(lerp(ca.r, cb.r, e), 0, grid.rows - 1),
    c: clampInt(lerp(ca.c, cb.c, e), 0, grid.cols - 1),
  };
  const rotate = lerp(a.rotate || 0, b.rotate || 0, e);
  const scale = lerp(a.scale == null ? 1 : a.scale, b.scale == null ? 1 : b.scale, e);
  return { cell, rotate, scale };
}

// motionRef.style.transform に書く文字列を作る。回転と拡縮だけの軽量版。
export function gestureTransform(sample) {
  if (!sample) return '';
  return `rotate(${sample.rotate.toFixed(2)}deg) scale(${sample.scale.toFixed(3)})`;
}
