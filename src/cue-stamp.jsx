// リアクション・スタンプの透過オーバーレイ（DOM/CSS）。
//
// アバターの上に「💢 ✨ ！？ こんにちは！」などをポップさせる軽量レイヤー。
// Pixi には依存しないので talk 版（素の <img>）でも camera 版でも同じものが使える。
// 透過背景のまま動くので OBS のオーバーレイにもそのまま乗る。
//
// 位置とサイズは「アバター要素(anchorRef)の実 getBoundingClientRect」から毎フレーム算出する。
// → アバターが顔追従/ドラッグ/ズームでどこへ動いても、スタンプが追従し、
//   表示サイズもアバターの描画幅に比例する（小さければ小さく、大きければ大きく）。
// 配置 place: 'above'（頭の上）/ 'over'（頭にオーバーレイ）。cue 由来。
//
// 使い方:
//   const charRef = useRef(null);   // アバター本体の要素
//   const stampRef = useRef(null);
//   <CueStampLayer ref={stampRef} anchorRef={charRef} />
//   stampRef.current.pop({ stamp:'💢', anim:'shake', holdMs:1100, place:'over' });

import React from 'react';
import { computeStampBox } from './cue-stamp-geometry.js';

const { useState, useRef, useImperativeHandle, forwardRef, useCallback } = React;

// アニメ種別 → CSS animation 名。cue-system の STAMP_ANIMS と対応。
const ANIM_NAME = {
  pop: 'cue-stamp-pop',
  rise: 'cue-stamp-rise',
  shake: 'cue-stamp-shake',
};

// 連番キー＆軽いジッター（同じ場所に固まらないよう左右にばらす）用のカウンタ。
let SEQ = 0;

// 位置算出パラメータ（OVER_SIZE / ABOVE_SIZE / HEAD_CENTER_Y）と配置式は
// cue-stamp-geometry.js に集約（cue-offset-editor.jsx とも共用・DOM 非依存でテスト可能）。

// アニメの移動量は em 単位（＝文字サイズ基準）にして、ズームで一緒に拡縮させる。
const KEYFRAMES = `
@keyframes cue-stamp-pop {
  0%   { transform: translate(-50%, 0) scale(0.3); opacity: 0; }
  18%  { transform: translate(-50%, -0.14em) scale(1.18); opacity: 1; }
  34%  { transform: translate(-50%, -0.10em) scale(1.0); opacity: 1; }
  78%  { transform: translate(-50%, -0.10em) scale(1.0); opacity: 1; }
  100% { transform: translate(-50%, -0.34em) scale(0.92); opacity: 0; }
}
@keyframes cue-stamp-rise {
  0%   { transform: translate(-50%, 0.24em) scale(0.6); opacity: 0; }
  16%  { transform: translate(-50%, 0) scale(1.05); opacity: 1; }
  70%  { opacity: 1; }
  100% { transform: translate(-50%, -2.6em) scale(0.9); opacity: 0; }
}
@keyframes cue-stamp-shake {
  0%   { transform: translate(-50%, 0) scale(0.3) rotate(0deg); opacity: 0; }
  14%  { transform: translate(-50%, 0) scale(1.15) rotate(0deg); opacity: 1; }
  24%  { transform: translate(calc(-50% - 0.18em), 0) scale(1.05) rotate(-8deg); }
  38%  { transform: translate(calc(-50% + 0.18em), 0) scale(1.05) rotate(8deg); }
  52%  { transform: translate(calc(-50% - 0.13em), 0) scale(1.0) rotate(-5deg); }
  66%  { transform: translate(calc(-50% + 0.10em), 0) scale(1.0) rotate(4deg); }
  80%  { transform: translate(-50%, 0) scale(1.0) rotate(0deg); opacity: 1; }
  100% { transform: translate(-50%, -0.26em) scale(0.95) rotate(0deg); opacity: 0; }
}
`;

function CueStampLayerImpl(props, ref) {
  const { anchorRef } = props;
  const [items, setItems] = useState([]);
  const timers = useRef(new Set());
  const itemEls = useRef(new Map()); // id → DOM ノード（位置を直書きする）

  // 1つのスタンプ要素を、アバター rect から算出した位置・サイズへ当てる。
  // ref コールバック（生成直後）と毎フレームの両方から呼ぶ。
  const placeNode = useCallback((node) => {
    if (!node) return;
    const el = anchorRef && anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (!r.width) return;
    // place / jit / cue 毎オフセット(ox,oy) は data-* で要素に載せ、毎フレームここで読む。
    const place = node.dataset.place === 'above' ? 'above' : 'over';
    const jit = Number(node.dataset.jit) || 0;
    const ox = Number(node.dataset.offsetX) || 0;
    const oy = Number(node.dataset.offsetY) || 0;
    const box = computeStampBox(r, { place, jit, ox, oy });
    node.style.fontSize = `${box.fontSize}px`;
    node.style.left = `${box.left}px`;
    node.style.top = `${box.top}px`;
  }, [anchorRef]);

  const pop = useCallback((cue) => {
    if (!cue || !cue.stamp) return;
    const id = ++SEQ;
    const anim = ANIM_NAME[cue.anim] ? cue.anim : 'pop';
    const holdMs = Number.isFinite(cue.holdMs) ? cue.holdMs : 1100;
    const place = cue.place === 'above' ? 'above' : 'over';
    // 文字サイズに対する相対ジッター（±0.3em 程度）。連打しても重ならないように。
    const jit = (((id * 53) % 56) - 28) / 90;
    // cue 毎のアバター相対オフセット（em）。__offset は発火側が { x, y } を差し込む。
    // 未指定・非有限は 0（＝従来の表示位置）。relay には乗らないローカル調整値。
    const off = cue.__offset;
    const ox = off && Number.isFinite(off.x) ? off.x : 0;
    const oy = off && Number.isFinite(off.y) ? off.y : 0;
    setItems((prev) => [...prev, { id, glyph: cue.stamp, anim, holdMs, place, jit, ox, oy }]);
    const timer = setTimeout(() => {
      setItems((prev) => prev.filter((it) => it.id !== id));
      timers.current.delete(timer);
    }, holdMs + 60);
    timers.current.add(timer);
  }, []);

  // 毎フレーム、生きているスタンプをアバターの現在位置・サイズへ追従させる。
  React.useEffect(() => {
    let raf;
    function frame() {
      raf = requestAnimationFrame(frame);
      if (itemEls.current.size === 0) return;
      itemEls.current.forEach((node) => placeNode(node));
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [placeNode]);

  // アンマウント時にタイマーを掃除（リーク防止）。
  React.useEffect(() => () => {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current.clear();
  }, []);

  useImperativeHandle(ref, () => ({ pop }), [pop]);

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute', inset: 0, overflow: 'visible',
        pointerEvents: 'none', zIndex: 5,
      }}
    >
      <style>{KEYFRAMES}</style>
      {items.map((it) => (
        <div
          key={it.id}
          ref={(node) => {
            const m = itemEls.current;
            if (node) { m.set(it.id, node); placeNode(node); }
            else m.delete(it.id);
          }}
          data-place={it.place}
          data-jit={it.jit}
          data-offset-x={it.ox}
          data-offset-y={it.oy}
          style={{
            position: 'absolute',
            left: 0, top: 0,          // placeNode が毎フレーム上書き
            fontSize: 1,              // placeNode が毎フレーム上書き
            lineHeight: 1,
            whiteSpace: 'nowrap',
            fontWeight: 800,
            color: '#fff',
            textShadow: '0 0.04em 0 rgba(60,48,38,0.25), 0 0 0.18em rgba(255,255,255,0.55)',
            WebkitTextStroke: '0.05em rgba(60,48,38,0.35)',
            filter: 'drop-shadow(0 0.06em 0.14em rgba(0,0,0,0.18))',
            animation: `${ANIM_NAME[it.anim]} ${it.holdMs}ms cubic-bezier(.2,.9,.2,1) forwards`,
            willChange: 'transform, opacity',
          }}
        >
          {it.glyph}
        </div>
      ))}
    </div>
  );
}

export const CueStampLayer = forwardRef(CueStampLayerImpl);
