// スマホでの「意図しないページズーム」を塞ぐ共通モジュール（本家 scaffold には無い fork 追加）。
//
// 目的: 背景ステージなどアバター以外をピンチしても、ブラウザがページ全体を拡大しない
// ようにする。iOS Safari は viewport の maximum-scale / user-scalable を無視するため、
// 抑止は JS のイベント層に一本化する（多重防御）。
//
// ── 壊さない条件（重要）──────────────────────────────────────────────────
//  - 1本指の touchmove は preventDefault しない → Tweaks パネル本体(.twk-body)の縦
//    スクロール、移動比率 range、<audio> シーク等は素通しで生存する。
//  - touchmove / wheel の preventDefault は「ブラウザ既定動作」を止めるだけで pointer
//    events の配信は止めない → camera 版アバターの2本指ピンチ（userRef の
//    setPointerCapture + pointerdown/move/up）や draggable-panel のドラッグは無傷。
//    むしろ gesturestart 抑止は「ピンチ中にページが拡大して指座標と DOM がズレる事故」を
//    防ぎ、アバターピンチを守る方向に働く。
//  - wheel は ctrlKey（トラックパッドのピンチ / Ctrl+ホイール）のときだけ止める。通常の
//    スクロールホイールは素通し。
//
// 設置は副作用を1関数に閉じ、cleanup を返す（React の useEffect 戻り値にそのまま使える）。

/**
 * touchmove の指の本数からピンチ（=2本指以上）かを判定する純関数。
 * @param {number} touchCount e.touches.length 相当
 * @returns {boolean} 2本指以上なら true（ページズーム抑止の対象）
 */
export function isPinchTouch(touchCount) {
  return touchCount >= 2;
}

/**
 * wheel がズーム操作（トラックパッドのピンチ / Ctrl+ホイール）かを判定する純関数。
 * 通常のスクロールホイール（ctrlKey なし）は false を返し、抑止しない。
 * @param {{ ctrlKey?: boolean }} e wheel イベント相当
 * @returns {boolean} ctrlKey が真なら true（ページズーム抑止の対象）
 */
export function isZoomWheel(e) {
  return !!(e && e.ctrlKey);
}

/**
 * ページ全体のピンチ／ダブルタップズームを抑止するリスナを設置する。
 * 1本指スクロールとアバターの pointer ピンチは温存する（上のコメント参照）。
 * @param {Document} [doc=document] 対象ドキュメント（テストではモックを渡す）
 * @param {Window} [win=window] 対象ウィンドウ（テストではモックを渡す）
 * @returns {() => void} 設置したリスナを全て外す cleanup 関数
 */
export function installMobileHardening(doc = document, win = window) {
  // preventDefault するには passive:false が必須（capture:false で remove と照合される）。
  const opts = { passive: false };

  // iOS Safari 専用のジェスチャイベント。他ブラウザでは発火しないので無条件で止めてよい。
  const onGesture = (e) => { e.preventDefault(); };
  // 2本指以上の touchmove だけ止める。1本指は早期 return で素通し（スクロール温存）。
  const onTouchMove = (e) => {
    const count = e.touches ? e.touches.length : 0;
    if (isPinchTouch(count)) e.preventDefault();
  };
  // トラックパッドのピンチ / Ctrl+ホイールだけ止める。通常スクロールは素通し。
  const onWheel = (e) => {
    if (isZoomWheel(e)) e.preventDefault();
  };

  doc.addEventListener('gesturestart', onGesture, opts);
  doc.addEventListener('gesturechange', onGesture, opts);
  doc.addEventListener('gestureend', onGesture, opts);
  doc.addEventListener('touchmove', onTouchMove, opts);
  win.addEventListener('wheel', onWheel, opts);

  return () => {
    doc.removeEventListener('gesturestart', onGesture, opts);
    doc.removeEventListener('gesturechange', onGesture, opts);
    doc.removeEventListener('gestureend', onGesture, opts);
    doc.removeEventListener('touchmove', onTouchMove, opts);
    win.removeEventListener('wheel', onWheel, opts);
  };
}
