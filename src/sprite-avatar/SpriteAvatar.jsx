// createSpriteAvatar（Pixi コア）を React から使う薄いラッパー。
// canvas を1枚出し、props の sheetIndex/cell をコアの setState/setCell へ橋渡しする。
// 親要素のサイズに追従するので、親（charRef ボックス）を vmin で可変にしてよい。
import React from 'react';
import { createSpriteAvatar } from './renderer';

const { useRef, useEffect } = React;

/**
 * @param {object} props
 * @param {string[]} props.sheets 状態シートURL配列（初期化時に固定。変更は想定しない）
 * @param {number} props.rows
 * @param {number} props.cols
 * @param {number} props.sheetIndex 表示状態(0..n-1 = A..F)
 * @param {{r:number,c:number}} props.cell 表示セル
 * @param {Object<string, object>} [props.effects] エフェクト設定（{ glow:{enabled,...}, ... }）
 * @param {React.CSSProperties} [props.style]
 */
export function SpriteAvatar({ sheets, rows, cols, sheetIndex, cell, effects, style }) {
  const canvasRef = useRef(null);
  const apiRef = useRef(null);
  // 初期化完了前に来た最新 props を見失わないよう ref で常に最新を保持する。
  const stateRef = useRef(sheetIndex);
  const cellRef = useRef(cell);
  const effectsRef = useRef(effects);
  stateRef.current = sheetIndex;
  cellRef.current = cell;
  effectsRef.current = effects;

  // 初期化は一度だけ（sheets/rows/cols は固定前提）。アンマウントで破棄。
  useEffect(() => {
    let disposed = false;
    createSpriteAvatar(canvasRef.current, {
      sheets,
      rows,
      cols,
      initialState: stateRef.current,
      initialCell: cellRef.current,
    }).then((api) => {
      if (disposed) { api.dispose(); return; }
      apiRef.current = api;
      // DEV 限定: コンソールから sprite.filters 等を検査・操作できるようにする（本番には出ない）。
      if (import.meta.env?.DEV) window.__avatar = api;
      // 初期化中に props が変わっていても最新へ揃える。
      api.setState(stateRef.current);
      api.setCell(cellRef.current.r, cellRef.current.c);
      applyEffects(api, effectsRef.current);
    }).catch((err) => {
      // 読み込み失敗時は黙って消さずログに残す（透過なので画面は空になる）。
      console.error('[SpriteAvatar] init failed:', err);
    });
    return () => {
      disposed = true;
      if (apiRef.current) { apiRef.current.dispose(); apiRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // props 変化をコアへ反映（初期化済みのときだけ）。
  useEffect(() => { apiRef.current?.setState(sheetIndex); }, [sheetIndex]);
  useEffect(() => { apiRef.current?.setCell(cell.r, cell.c); }, [cell.r, cell.c]);
  useEffect(() => { if (apiRef.current) applyEffects(apiRef.current, effects); }, [effects]);

  return (
    <canvas
      ref={canvasRef}
      style={{ display: 'block', width: '100%', height: '100%', ...style }}
    ></canvas>
  );
}

// effects オブジェクト（{ glow:{enabled,...}, bloom:{...}, dissolve:{...} }）を
// コアの setEffect へ流す。setEffect は idempotent なので毎回全キー呼んでよい。
function applyEffects(api, effects) {
  if (!effects) return;
  for (const name of Object.keys(effects)) {
    api.setEffect(name, effects[name]);
  }
}
