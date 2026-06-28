// useMouseTarget — マウス/タッチのカーソル位置を targetRef.current.{x,y}(-1..1) に書く
// React フック。useFacePose と同じ target 契約に載るので、描画側(camera-app)は出どころを
// 問わない（顔追従の pointermove 版差し替え）。
//
// アンカー要素は「画面に固定された安定要素(stageRef 等)」を渡すこと。アバター本体(charRef)は
// ドラッグ/ズーム/かしげで毎フレーム transform されるため、それを中心に使うと追従が自己発振する。
// pointerdown も購読するのは、ホバーの無いタッチ環境(スマホ)で tap/drag に反応させるため。
import React from 'react';
import { pointerToTarget } from './pointer-target';

const { useRef, useEffect } = React;

/**
 * @param {{ current: { x: number, y: number } }} targetRef 書き込み先（-1..1）
 * @param {{ current: HTMLElement|null }} anchorRef 追従中心に使う安定要素（例: stageRef）
 * @param {{ enabled?: boolean, followRange?: number, invertX?: boolean, invertY?: boolean }} [opts]
 */
export function useMouseTarget(targetRef, anchorRef, opts = {}) {
  const { enabled = true, followRange = 340, invertX = false, invertY = false } = opts;

  // 最新の設定値をループ内で参照するための ref（変わるたびに再購読しない）。
  const rangeRef = useRef(followRange);
  rangeRef.current = followRange;
  const invertRef = useRef({ invertX, invertY });
  invertRef.current = { invertX, invertY };

  useEffect(() => {
    if (!enabled) return undefined;
    function onMove(e) {
      const el = anchorRef.current;
      if (!el) return;
      const tgt = pointerToTarget(
        e.clientX, e.clientY, el.getBoundingClientRect(), rangeRef.current, invertRef.current,
      );
      targetRef.current.x = tgt.x;
      targetRef.current.y = tgt.y;
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerdown', onMove);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onMove);
    };
  }, [enabled, targetRef, anchorRef]);
}
