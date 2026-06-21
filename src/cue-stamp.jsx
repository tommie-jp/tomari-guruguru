// リアクション・スタンプの透過オーバーレイ（DOM/CSS）。
//
// アバターの上に「💢 ✨ ！？ こんにちは！」などをポップさせる軽量レイヤー。
// Pixi には依存しないので talk 版（素の <img>）でも camera 版でも同じものが使える。
// 透過背景のまま動くので OBS のオーバーレイにもそのまま乗る。
//
// 使い方:
//   const stampRef = useRef(null);
//   <div style={{ position:'relative' }}>
//     ...avatar...
//     <CueStampLayer ref={stampRef} />
//   </div>
//   stampRef.current.pop({ stamp:'💢', anim:'shake', holdMs:1100 });

import React from 'react';

const { useState, useRef, useImperativeHandle, forwardRef, useCallback } = React;

// アニメ種別 → CSS animation 名。cue-system の STAMP_ANIMS と対応。
const ANIM_NAME = {
  pop: 'cue-stamp-pop',
  rise: 'cue-stamp-rise',
  shake: 'cue-stamp-shake',
};

// 連番キー＆軽いジッター（同じ場所に固まらないよう左右にばらす）用のカウンタ。
let SEQ = 0;

const KEYFRAMES = `
@keyframes cue-stamp-pop {
  0%   { transform: translate(-50%, 0) scale(0.3); opacity: 0; }
  18%  { transform: translate(-50%, -6px) scale(1.18); opacity: 1; }
  34%  { transform: translate(-50%, -4px) scale(1.0); opacity: 1; }
  78%  { transform: translate(-50%, -4px) scale(1.0); opacity: 1; }
  100% { transform: translate(-50%, -14px) scale(0.92); opacity: 0; }
}
@keyframes cue-stamp-rise {
  0%   { transform: translate(-50%, 10px) scale(0.6); opacity: 0; }
  16%  { transform: translate(-50%, 0) scale(1.05); opacity: 1; }
  70%  { opacity: 1; }
  100% { transform: translate(-50%, -120px) scale(0.9); opacity: 0; }
}
@keyframes cue-stamp-shake {
  0%   { transform: translate(-50%, 0) scale(0.3) rotate(0deg); opacity: 0; }
  14%  { transform: translate(-50%, 0) scale(1.15) rotate(0deg); opacity: 1; }
  24%  { transform: translate(calc(-50% - 7px), 0) scale(1.05) rotate(-8deg); }
  38%  { transform: translate(calc(-50% + 7px), 0) scale(1.05) rotate(8deg); }
  52%  { transform: translate(calc(-50% - 5px), 0) scale(1.0) rotate(-5deg); }
  66%  { transform: translate(calc(-50% + 4px), 0) scale(1.0) rotate(4deg); }
  80%  { transform: translate(-50%, 0) scale(1.0) rotate(0deg); opacity: 1; }
  100% { transform: translate(-50%, -10px) scale(0.95) rotate(0deg); opacity: 0; }
}
`;

function CueStampLayerImpl(props, ref) {
  // top / bottom のどちらかで縦位置を指定する。bottom を渡すと「下端基準」で配置し、
  // アバターの頭上（キャラ上端）に貼り付けて上方向へ浮かせる用途に使う。
  const { top = '8%', bottom } = props;
  const [items, setItems] = useState([]);
  const timers = useRef(new Set());

  const pop = useCallback((cue) => {
    if (!cue || !cue.stamp) return;
    const id = ++SEQ;
    const anim = ANIM_NAME[cue.anim] ? cue.anim : 'pop';
    const holdMs = Number.isFinite(cue.holdMs) ? cue.holdMs : 1100;
    // 左右に ±28px ほどばらして連打しても重ならないようにする。
    const jitter = ((id * 53) % 56) - 28;
    setItems((prev) => [...prev, { id, glyph: cue.stamp, anim, holdMs, jitter }]);
    const timer = setTimeout(() => {
      setItems((prev) => prev.filter((it) => it.id !== id));
      timers.current.delete(timer);
    }, holdMs + 60);
    timers.current.add(timer);
  }, []);

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
          style={{
            position: 'absolute',
            left: `calc(50% + ${it.jitter}px)`,
            ...(bottom != null ? { bottom } : { top }),
            fontSize: 'clamp(34px, 8vmin, 90px)',
            lineHeight: 1,
            whiteSpace: 'nowrap',
            fontWeight: 800,
            color: '#fff',
            textShadow: '0 2px 0 rgba(60,48,38,0.25), 0 0 10px rgba(255,255,255,0.55)',
            WebkitTextStroke: '2px rgba(60,48,38,0.35)',
            filter: 'drop-shadow(0 4px 10px rgba(0,0,0,0.18))',
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
