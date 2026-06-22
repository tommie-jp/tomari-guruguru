import React from 'react';
import { DraggablePanel } from './draggable-panel.jsx';
import { stampFontSize } from './cue-stamp-geometry.js';
import { clampCueOffset } from './use-tweaks.js';

// 演出（スタンプ）のアバター相対オフセットをドラッグで調整するエディタ（camera 版専用）。
//
//  - 掴む面はアバター本体: 編集中だけ透明な全面オーバーレイを敷き、ドラッグ量(px)を em(=スタンプ
//    fontSize 比)へ換算する。fontSize はアバター幅基準なので、ズーム/charSize/解像度が変わっても
//    保存値はスケール不変（cue-stamp-geometry.js と同じ単位）。
//  - パネルは退避できるクローム（既存 DraggablePanel 流用）。保存/やめる/既定に戻す＋現在値を表示。
//  - ライブプレビュー: 編集中の cue を draft オフセットで holdMs 間隔に再 pop（本番と同一 placeNode）。
//  - 確定は常に明示。ドラッグでは自動保存しない（誤操作で保存値を壊さない）。
//  - 呼び出し側で !obsMode && !isRx ゲート済み前提。z 順: オーバーレイ(30) < サウンドボード(40) < パネル(50)。
//
// props:
//   cue       … 編集対象の cue（id, label, place, stamp, holdMs を使う）
//   anchorRef … アバター本体要素の ref（getBoundingClientRect で幅を読む）
//   initial   … 現在の保存オフセット { x, y }（未保存なら undefined → {0,0}）
//   dark      … パネル配色（テーマ追従）
//   onCommit(offset) … 保存ボタン。clamp 済みオフセットを渡す
//   onClose()        … やめる/✕。draft を破棄して閉じる
//   preview(cue)     … スタンプを1回 pop する関数（ライブプレビュー用）

const { useState, useRef, useEffect, useCallback } = React;

const OVERLAY_Z = 30;
const PANEL_Z = 50;
const MOVE_LIMIT = 1.5; // em。clampCueOffset の既定と揃える（画面外へ飛ばさない）。

function btnStyle(dark, primary) {
  return {
    flex: 1, padding: '6px 8px', fontSize: 12, fontWeight: 700, lineHeight: 1,
    borderRadius: 9, cursor: 'pointer', whiteSpace: 'nowrap',
    border: `1.5px solid ${dark ? 'rgba(255,248,238,0.18)' : 'rgba(60,48,38,0.14)'}`,
    background: primary
      ? (dark ? '#5B8DEF' : '#3B74E8')
      : (dark ? 'rgba(70,66,60,0.9)' : 'rgba(255,255,255,0.92)'),
    color: primary ? '#fff' : (dark ? '#F7F1E8' : '#3C3026'),
    fontFamily: "'Zen Maru Gothic', sans-serif",
  };
}

function CueOffsetEditor({ cue, anchorRef, initial, dark = false, onCommit, onClose, preview }) {
  const draftRef = useRef(clampCueOffset(initial, -MOVE_LIMIT, MOVE_LIMIT));
  const [draft, setDraft] = useState(draftRef.current);
  // ドラッグ開始時の指位置とオフセットを覚える（move ハンドラが基準にする）。
  const startRef = useRef({ x: 0, y: 0, ox: 0, oy: 0, active: false });
  // 最新の cue を interval から参照する（cue 差し替え時の stale 回避）。
  const cueRef = useRef(cue);
  cueRef.current = cue;

  const setDraftBoth = useCallback((next) => {
    draftRef.current = next;
    setDraft(next);
  }, []);

  // cue を選び直したら draft を保存値で初期化する。
  useEffect(() => {
    const init = clampCueOffset(initial, -MOVE_LIMIT, MOVE_LIMIT);
    draftRef.current = init;
    setDraft(init);
    startRef.current.active = false;
    // initial は cue 切替時にしか変えない前提。cue.id を依存にして初期化を1回に絞る。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cue.id]);

  // ライブプレビュー: 実スタンプを draft オフセットで定期 pop（本番経路と同一の placeNode で描く）。
  useEffect(() => {
    if (!cue.stamp || typeof preview !== 'function') return undefined;
    const fire = () => preview({ ...cueRef.current, __offset: draftRef.current });
    fire(); // 開始時に即1回
    const ms = (Number.isFinite(cue.holdMs) ? cue.holdMs : 1100) + 150;
    const timer = setInterval(fire, ms);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cue.id, cue.stamp, cue.holdMs, preview]);

  const onPointerDown = (e) => {
    const el = e.currentTarget;
    e.preventDefault();
    startRef.current = {
      x: e.clientX, y: e.clientY,
      ox: draftRef.current.x, oy: draftRef.current.y, active: true,
    };
    try { el.setPointerCapture(e.pointerId); } catch { /* 古い環境では無視 */ }
  };
  const onPointerMove = (e) => {
    const s = startRef.current;
    if (!s.active) return;
    const node = anchorRef && anchorRef.current;
    if (!node) return;
    const r = node.getBoundingClientRect();
    const fs = stampFontSize(r.width, cue.place) || 1; // 0除算ガード
    setDraftBoth(clampCueOffset({
      x: s.ox + (e.clientX - s.x) / fs,
      y: s.oy + (e.clientY - s.y) / fs,
    }, -MOVE_LIMIT, MOVE_LIMIT));
  };
  const endDrag = () => { startRef.current.active = false; };

  const pct = (v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`;

  return (
    <>
      {/* ドラッグ面（アバター全面）。アバターより上・パネル/サウンドボードより下。 */}
      <div
        aria-hidden="true"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{
          position: 'fixed', inset: 0, zIndex: OVERLAY_Z,
          cursor: 'move', touchAction: 'none', background: 'transparent',
        }}
      />
      <DraggablePanel
        id="cueoffset-editor"
        title={`位置調整: ${cue.label || cue.id}`}
        onClose={onClose}
        closeLabel="調整をやめる"
        resizable={false}
        defaultStyle={{ left: 16, bottom: 16, top: 'auto' }}
        style={{
          zIndex: PANEL_Z, borderRadius: 12, padding: '10px 12px 12px', minWidth: 210,
          background: dark ? 'rgba(40,38,35,0.94)' : 'rgba(255,255,255,0.96)',
          color: dark ? '#F7F1E8' : '#3C3026',
          boxShadow: '0 8px 28px rgba(60,48,38,0.22)',
          border: `1.5px solid ${dark ? 'rgba(255,248,238,0.16)' : 'rgba(60,48,38,0.12)'}`,
          fontFamily: "'Zen Maru Gothic', sans-serif",
        }}
      >
        {/* 本文はドラッグ非対象（パネルはタイトル帯で動かす）。 */}
        <div data-no-drag style={{ fontSize: 12, lineHeight: 1.5 }}>
          <div style={{ opacity: 0.82, marginBottom: 7 }}>
            アバターをドラッグして位置を調整
          </div>
          <div style={{
            display: 'flex', gap: 14, marginBottom: 9,
            fontVariantNumeric: 'tabular-nums', fontWeight: 700,
          }}>
            <span>左右 {pct(draft.x)}</span>
            <span>上下 {pct(draft.y)}</span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" data-no-drag onClick={() => onCommit(draftRef.current)} style={btnStyle(dark, true)}>✓ 保存</button>
            <button type="button" data-no-drag onClick={onClose} style={btnStyle(dark)}>✕ やめる</button>
            <button type="button" data-no-drag onClick={() => setDraftBoth({ x: 0, y: 0 })} style={btnStyle(dark)}>↺ 既定</button>
          </div>
        </div>
      </DraggablePanel>
    </>
  );
}

export { CueOffsetEditor };
