// お絵かきオーバーレイ（fabric.js）。アバターの上に透過キャンバスを1枚重ねる。
//
// 役割は2つ:
//   - mode='edit'（操作側 tx/local）: fabric.Canvas で実際に描く。ツールバー付き。
//       描画が確定するたび onSceneChange({scene,w,h}) を呼ぶ → camera-app が relay で rx へ送る。
//   - mode='view'（OBS 側 rx）: fabric.StaticCanvas で受信シーンを再描画するだけ（操作不可）。
//       loadScene({scene,w,h}) を ref 経由で受け取り、setViewportTransform で送信元サイズへ拡縮。
//
// 透過: backgroundColor は設定しない（fabric 既定で透明）。コンテナも背景を塗らない。
//   描いていない領域はアルファ0のままなので、既存の obsMode 透過にそのまま乗る。
// 消しゴム: @erase2d/fabric の EraserBrush。消去結果はベクタの clipPath(ClippingGroup,
//   type:'clipping') として各オブジェクトに保存され、toObject→loadFromJSON で同期復元できる。
//   ※ import '@erase2d/fabric' が classRegistry に 'clipping' を登録する。tx/rx 双方で必須。
//   ※ @erase2d は object.erasable が真のオブジェクトしか消さない（fabric v7 既定は未設定）。
//      → 追加した全オブジェクトに erasable:true を立てる（object:added で付与）。
//
// 入力競合: 道具 'off' のときはコンテナを pointerEvents:'none' にして下のアバター操作を通す。
//   道具を選ぶと 'auto' になり描画面が pointer を受ける（描画中はアバターを掴めない）。
import React from 'react';
import * as fabric from 'fabric';
import '@erase2d/fabric'; // 副作用: ClippingGroup を classRegistry へ登録（消しゴム復元に必須）
import { EraserBrush } from '@erase2d/fabric';

const { useRef, useEffect, useState, useImperativeHandle, forwardRef, useCallback } = React;

const DEFAULT_COLOR = '#ff3b30';
const DEFAULT_WIDTH = 6;
const ERASER_SCALE = 3;          // 消しゴム幅 = ペン幅 × 係数
const SEND_DEBOUNCE_MS = 140;    // 描画確定→送信のまとめ送り
const HISTORY_MAX = 40;          // undo スナップショット上限
const MAX_OBJECTS = 4000;        // rx 受信時の防御（無認証 WS の偽注入対策）
const FONT_FAMILY = "'Zen Maru Gothic', sans-serif";

// 色/太さの簡易永続化（localStorage）。失敗は握りつぶす（描画機能の本質ではない）。
const LS_KEY = 'guruguru-draw';
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; }
}
function savePrefs(p) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(p)); } catch { /* noop */ }
}

function DrawLayerImpl(props, ref) {
  const { mode, showToolbar, active = true } = props; // mode: 'edit' | 'view'
  const isEdit = mode === 'edit';

  // 最新の onSceneChange を ref で持つ（再購読せずに中身だけ差し替え）。
  const onSceneChangeRef = useRef(props.onSceneChange);
  onSceneChangeRef.current = props.onSceneChange;

  const containerRef = useRef(null);
  const canvasElRef = useRef(null);
  const fcRef = useRef(null);              // fabric.Canvas（edit）/ fabric.StaticCanvas（view）
  const lastSrcRef = useRef({ w: 0, h: 0 }); // view: 送信元キャンバスサイズ（VPT 算出用）
  const sendTimerRef = useRef(0);
  const historyRef = useRef([]);          // edit: scene JSON 文字列のスナップショット
  const suppressRef = useRef(false);      // load 中は変更通知を止める
  const eraserDisposerRef = useRef(null); // EraserBrush の 'end' リスナ解除関数

  const prefs = loadPrefs();
  const [tool, setTool] = useState('off'); // 'off' | 'pen' | 'eraser' | 'select' | 'text'
  const [color, setColor] = useState(prefs.color || DEFAULT_COLOR);
  const [width, setWidth] = useState(prefs.width || DEFAULT_WIDTH);

  // イベントハンドラ（init で1度だけ束縛）から最新値を読むための ref。
  const toolRef = useRef(tool); toolRef.current = tool;
  const colorRef = useRef(color); colorRef.current = color;
  const widthRef = useRef(width); widthRef.current = width;

  // --- 直列化 / VPT -------------------------------------------------------
  // edit のシーンを {scene, w, h} で取り出す。erasable も含めて future-proof に。
  const serialize = useCallback(() => {
    const fc = fcRef.current;
    if (!fc) return null;
    return { scene: fc.toObject(['erasable']), w: fc.getWidth(), h: fc.getHeight() };
  }, []);

  // view: 送信元(w,h)→自分(getWidth/Height)へ全体を拡縮する viewportTransform を当てる。
  const applyVpt = useCallback(() => {
    const fc = fcRef.current;
    if (!fc) return;
    const { w, h } = lastSrcRef.current;
    if (!w || !h) return;
    fc.setViewportTransform([fc.getWidth() / w, 0, 0, fc.getHeight() / h, 0, 0]);
  }, []);

  // --- 履歴（undo） -------------------------------------------------------
  const pushHistory = useCallback(() => {
    const fc = fcRef.current;
    if (!fc) return;
    const snap = JSON.stringify(fc.toObject(['erasable']));
    const h = historyRef.current;
    if (h.length && h[h.length - 1] === snap) return; // 変化なしは積まない
    h.push(snap);
    if (h.length > HISTORY_MAX) h.shift();
  }, []);

  // --- 送信（デバウンス） -------------------------------------------------
  const scheduleSend = useCallback(() => {
    if (suppressRef.current) return;
    clearTimeout(sendTimerRef.current);
    sendTimerRef.current = setTimeout(() => {
      pushHistory();
      const payload = serialize();
      if (payload) onSceneChangeRef.current?.(payload);
    }, SEND_DEBOUNCE_MS);
  }, [pushHistory, serialize]);

  // 履歴文字列 or 受信シーンを canvas に流し込む（変更通知を止めてから）。
  const applyScene = useCallback((sceneObj) => {
    const fc = fcRef.current;
    if (!fc) return Promise.resolve();
    suppressRef.current = true;
    return fc.loadFromJSON(sceneObj)
      .then(() => {
        if (mode === 'view') applyVpt();
        else fc.forEachObject((o) => { o.selectable = false; o.evented = false; });
        fc.requestRenderAll();
      })
      .catch(() => { /* 壊れたシーンは無視 */ })
      .finally(() => { suppressRef.current = false; });
  }, [mode, applyVpt]);

  // --- fabric の初期化（mode 毎に1度） -----------------------------------
  useEffect(() => {
    const el = canvasElRef.current;
    if (!el) return undefined;
    // 透過: backgroundColor は渡さない（既定で透明）。
    const fc = isEdit
      ? new fabric.Canvas(el, { selection: false, preserveObjectStacking: true })
      : new fabric.StaticCanvas(el, { renderOnAddRemove: false });
    fcRef.current = fc;
    fc.setDimensions({ width: window.innerWidth, height: window.innerHeight });

    if (isEdit) {
      // 追加された実オブジェクトは消しゴム対象にする（@erase2d は erasable 真のみ消す）。
      fc.on('object:added', (e) => {
        const o = e.target;
        if (o && o.erasable === undefined) o.set('erasable', true);
      });
      const change = () => scheduleSend();
      fc.on('object:added', change);
      fc.on('object:removed', change);
      fc.on('object:modified', change);
      fc.on('text:changed', change);
      // テキスト道具: 空き領域クリックで IText を置いて即編集に入る。
      fc.on('mouse:down', (opt) => {
        if (toolRef.current !== 'text' || opt.target) return;
        const p = fc.getScenePoint(opt.e);
        const it = new fabric.IText('', {
          left: p.x, top: p.y, fill: colorRef.current,
          fontSize: Math.max(18, widthRef.current * 4), fontFamily: FONT_FAMILY,
          erasable: true, selectable: true, evented: true,
        });
        fc.add(it);
        fc.setActiveObject(it);
        it.enterEditing();
        it.hiddenTextarea?.focus();
      });
      // 空テキストのまま編集を抜けたら削除（ゴミを残さない）。
      fc.on('text:editing:exited', (e) => {
        const t = e.target;
        if (t && !String(t.text || '').trim()) fc.remove(t);
      });
      pushHistory(); // 初期スナップショット（空）
    }

    return () => {
      clearTimeout(sendTimerRef.current);
      if (eraserDisposerRef.current) { eraserDisposerRef.current(); eraserDisposerRef.current = null; }
      try { fc.dispose(); } catch { /* noop */ }
      fcRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // --- 道具/色/太さの反映（edit のみ） -----------------------------------
  useEffect(() => {
    const fc = fcRef.current;
    if (!fc || !isEdit) return;
    if (eraserDisposerRef.current) { eraserDisposerRef.current(); eraserDisposerRef.current = null; }
    fc.isDrawingMode = (tool === 'pen' || tool === 'eraser');
    fc.selection = (tool === 'select');
    fc.forEachObject((o) => { o.selectable = (tool === 'select'); o.evented = (tool === 'select'); });
    if (tool === 'pen') {
      const b = new fabric.PencilBrush(fc);
      b.color = color;
      b.width = width;
      fc.freeDrawingBrush = b;
    } else if (tool === 'eraser') {
      const e = new EraserBrush(fc);
      e.width = Math.max(8, width * ERASER_SCALE);
      fc.freeDrawingBrush = e;
      eraserDisposerRef.current = e.on('end', () => scheduleSend());
    }
    fc.requestRenderAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, color, width, mode]);

  // --- リサイズ追従 -------------------------------------------------------
  useEffect(() => {
    function resize() {
      const fc = fcRef.current;
      if (!fc) return;
      fc.setDimensions({ width: window.innerWidth, height: window.innerHeight });
      if (mode === 'view') applyVpt();
      fc.requestRenderAll();
    }
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [mode, applyVpt]);

  // 全消し（object:removed → scheduleSend で空シーンが rx へ伝わる）。
  const doClear = useCallback(() => {
    const fc = fcRef.current;
    if (!fc) return;
    const objs = fc.getObjects ? [...fc.getObjects()] : [];
    if (objs.length) fc.remove(...objs);
    fc.requestRenderAll();
  }, []);

  // 直前の確定状態へ戻す。
  const doUndo = useCallback(() => {
    const fc = fcRef.current;
    if (!fc) return;
    const h = historyRef.current;
    if (h.length < 2) {
      doClear(); // 初期スナップショットのみ → 全消し
      return;
    }
    h.pop(); // 現在を捨て
    const prev = h[h.length - 1];
    let sceneObj;
    try { sceneObj = JSON.parse(prev); } catch { return; }
    applyScene(sceneObj).then(() => {
      const payload = serialize();
      if (payload) onSceneChangeRef.current?.(payload);
    });
  }, [applyScene, serialize, doClear]);

  // --- 命令的 API（camera-app から呼ぶ） ---------------------------------
  useImperativeHandle(ref, () => ({
    // rx: 受信シーンを描画。無認証 WS 前提でサイズ・件数を検証してから流す。
    loadScene(payload) {
      const fc = fcRef.current;
      if (!fc || !payload || typeof payload !== 'object') return;
      const scene = payload.scene;
      if (!scene || typeof scene !== 'object' || !Array.isArray(scene.objects)) return;
      if (scene.objects.length > MAX_OBJECTS) return;
      lastSrcRef.current = {
        w: Number(payload.w) || fc.getWidth(),
        h: Number(payload.h) || fc.getHeight(),
      };
      applyScene(scene);
    },
    // tx: 後着 OBS への再送用。空なら null（既定の空状態なので送らない）。
    getScene() {
      const fc = fcRef.current;
      if (!fc) return null;
      const objs = fc.getObjects ? fc.getObjects() : [];
      if (!objs.length) return null;
      return serialize();
    },
    clear: doClear,
    undo: doUndo,
  }), [applyScene, serialize, doClear, doUndo]);

  // お絵かき OFF（active=false）にしたら道具を「手」に戻す（入力を下のアバターへ通す）。
  useEffect(() => {
    if (isEdit && !active) setTool('off');
  }, [isEdit, active]);

  const onPickColor = (v) => { setColor(v); savePrefs({ ...loadPrefs(), color: v }); };
  const onPickWidth = (v) => { setWidth(v); savePrefs({ ...loadPrefs(), width: v }); };

  return (
    <div
      ref={containerRef}
      aria-hidden={!isEdit}
      style={{
        position: 'absolute', inset: 0, zIndex: 6,
        // OFF・'手'・view では下のアバター操作を通す。お絵かき ON かつ道具選択中だけ pointer を受ける。
        pointerEvents: isEdit && active && tool !== 'off' ? 'auto' : 'none',
      }}
    >
      <canvas ref={canvasElRef} />
      {showToolbar ? (
        <DrawToolbar
          tool={tool} setTool={setTool}
          color={color} onColor={onPickColor}
          width={width} onWidth={onPickWidth}
          onClear={doClear}
          onUndo={doUndo}
        />
      ) : null}
    </div>
  );
}

const TOOL_BTNS = [
  { id: 'off', label: '手' },
  { id: 'pen', label: 'ペン' },
  { id: 'eraser', label: '消し' },
  { id: 'select', label: '選択' },
  { id: 'text', label: '文字' },
];

function DrawToolbar({ tool, setTool, color, onColor, width, onWidth, onClear, onUndo }) {
  return (
    <div
      style={{
        position: 'fixed', top: 10, left: '50%', transform: 'translateX(-50%)',
        zIndex: 7, pointerEvents: 'auto',
        display: 'flex', gap: 6, alignItems: 'center',
        padding: '6px 10px', background: 'rgba(30,30,34,0.86)', color: '#fff',
        borderRadius: 10, fontSize: 12, fontFamily: FONT_FAMILY,
        boxShadow: '0 4px 16px rgba(0,0,0,0.3)', userSelect: 'none',
      }}
    >
      {TOOL_BTNS.map((b) => (
        <button
          key={b.id}
          onClick={() => setTool(b.id)}
          style={{
            border: 'none', borderRadius: 7, cursor: 'pointer',
            padding: '5px 9px', fontSize: 12, fontWeight: 700,
            background: tool === b.id ? '#3b74e8' : 'rgba(255,255,255,0.14)',
            color: '#fff',
          }}
        >{b.label}</button>
      ))}
      <input
        type="color" value={color} onChange={(e) => onColor(e.target.value)}
        title="色" aria-label="色"
        style={{ width: 28, height: 26, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
      />
      <input
        type="range" min={1} max={40} step={1} value={width}
        onChange={(e) => onWidth(Number(e.target.value))}
        title="太さ" aria-label="太さ"
        style={{ width: 80 }}
      />
      <button
        onClick={onUndo}
        style={{ border: 'none', borderRadius: 7, cursor: 'pointer', padding: '5px 9px', fontSize: 12, fontWeight: 700, background: 'rgba(255,255,255,0.14)', color: '#fff' }}
      >戻す</button>
      <button
        onClick={onClear}
        style={{ border: 'none', borderRadius: 7, cursor: 'pointer', padding: '5px 9px', fontSize: 12, fontWeight: 700, background: 'rgba(229,72,77,0.85)', color: '#fff' }}
      >全消し</button>
    </div>
  );
}

export const DrawLayer = forwardRef(DrawLayerImpl);
