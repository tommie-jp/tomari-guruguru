import React from 'react';
import {
  loadPanelPos, savePanelPos, clearPanelPos, clampPanelPos,
} from './use-tweaks.js';

// fork: ドラッグで移動できる汎用パネル枠（本家 scaffold には無い追加）。
// カメラ版の HUD（カメラプレビュー / デバッグ / 表情係数）を掴んで動かし、
// ✕で隠せるようにするために導入した。設計の要点:
//
//  - 操作: マウス・タッチ・ペンの全部対応（pointer events + touch-action:none）。
//  - 掴む面: パネル全体。[data-no-drag] を付けた要素（✕ボタン）の上では開始しない。
//  - ✕: onClose を呼ぶ。呼び出し側で該当トグルを false にして隠す想定
//        （= Tweaks のトグルと state を共有し、そこから再表示できる）。
//  - ダブルクリック: 既定位置に戻す（localStorage の保存もクリア）。
//  - 永続化: ドラッグ終了時に {left, top} を localStorage へ（ページ × id 単位）。
//  - リサイズ: 画面が縮んでパネルが外へ出たら内側へ再クランプ。
//
// 位置モデルは left/top（px・position:fixed）に統一する。初期位置は呼び出し側が
// defaultStyle（例 {top:16,left:16} や {top:68,right:12}）で“アンカー”を渡し、
// 初回レンダーの実測矩形を left/top に変換して以降はそれを基準にする。これで
// right/bottom 基準の既定でもドラッグへ素直に移行できる。
//
// disabled: カメラプレビューのように「映像は検出のため常時マウントしたいが、
// 非表示のときはドラッグ枠を出したくない」ケース向け。disabled の間は位置管理も
// ドラッグも止め、呼び出し側 style（画面外 1px など）にそのまま委ねる。要素の
// 同一性は保つので <video> のストリームは貼り直されない。

const PAD = 8;

function viewport() {
  return { width: window.innerWidth, height: window.innerHeight };
}

function DraggablePanel({
  id,
  onClose,
  closeLabel = 'このパネルを隠す',
  className,
  style,
  defaultStyle,
  disabled = false,
  children,
}) {
  const ref = React.useRef(null);
  const [pos, setPos] = React.useState(null); // {left, top}。null=既定アンカーで配置中
  const posRef = React.useRef(null);          // 最新位置（move ハンドラから参照）
  const defaultRef = React.useRef(null);       // 初回実測の既定位置（ダブルクリック復帰用）

  const sizeOf = React.useCallback(() => {
    const el = ref.current;
    return { width: el ? el.offsetWidth : 0, height: el ? el.offsetHeight : 0 };
  }, []);

  const clamp = React.useCallback(
    (p) => clampPanelPos(p, viewport(), sizeOf(), PAD),
    [sizeOf],
  );

  // 初期位置: 保存値があれば復元、無ければ実測の既定を採用。disabled の間は何もしない。
  React.useLayoutEffect(() => {
    if (disabled) return;
    const el = ref.current;
    if (!el) return;
    if (posRef.current) { setPos(posRef.current); return; }
    const r = el.getBoundingClientRect();
    const def = clamp({ left: r.left, top: r.top });
    defaultRef.current = def;
    const saved = loadPanelPos(id);
    const init = saved ? clamp(saved) : def;
    posRef.current = init;
    setPos(init);
  }, [disabled, id, clamp]);

  // リサイズで画面外に出たら内側へ戻す。
  React.useEffect(() => {
    const onResize = () => {
      if (disabled || !posRef.current) return;
      const c = clamp(posRef.current);
      posRef.current = c;
      setPos(c);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [disabled, clamp]);

  const onPointerDown = (e) => {
    // ✕ などドラッグさせたくない要素の上では開始しない。
    if (e.target.closest && e.target.closest('[data-no-drag]')) return;
    const el = ref.current;
    if (!el) return;
    e.preventDefault();
    const start = posRef.current || { left: el.offsetLeft, top: el.offsetTop };
    const sx = e.clientX, sy = e.clientY;
    try { el.setPointerCapture(e.pointerId); } catch { /* 古い環境では無視 */ }
    const move = (ev) => {
      const next = clamp({ left: start.left + (ev.clientX - sx), top: start.top + (ev.clientY - sy) });
      posRef.current = next;
      setPos(next);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      if (posRef.current) savePanelPos(id, posRef.current);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  // 既定位置へ戻す（保存もクリア）。
  const onResetPos = () => {
    clearPanelPos(id);
    const def = defaultRef.current;
    if (def) { posRef.current = def; setPos(def); }
  };

  // disabled のときは呼び出し側 style にそのまま委ね、ドラッグ枠を出さない。
  const place = disabled
    ? null
    : (pos
      ? { left: pos.left, top: pos.top, right: 'auto', bottom: 'auto' }
      : defaultStyle);
  const finalStyle = disabled
    ? style
    : { position: 'fixed', cursor: 'move', touchAction: 'none', ...style, ...place };

  return (
    <div
      ref={ref}
      className={className}
      style={finalStyle}
      onPointerDown={disabled ? undefined : onPointerDown}
      onDoubleClick={disabled ? undefined : onResetPos}
    >
      {/* ✕ は常にマウント（index 固定で children の再マウントを防ぐ）。disabled 時は隠す。 */}
      {onClose && (
        <button
          type="button"
          data-no-drag
          aria-label={closeLabel}
          title={closeLabel}
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top: 4, right: 4, width: 20, height: 20,
            display: disabled ? 'none' : 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 0, border: 0, borderRadius: '50%', cursor: 'pointer', zIndex: 2,
            background: 'rgba(0,0,0,0.45)', color: '#fff', fontSize: 12, lineHeight: 1,
            boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
          }}
        >✕</button>
      )}
      {children}
    </div>
  );
}

export { DraggablePanel };
