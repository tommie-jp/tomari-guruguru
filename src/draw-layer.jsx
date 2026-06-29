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
import { DraggablePanel } from './draggable-panel.jsx'; // ツールバーをドラッグ移動可能にする
import {
  MAX_LIVE_PTS, sanitizeLivePoints, isRenderablePts, clampLiveWidth, sanitizeLiveColor,
} from './draw-live'; // 描画途中のライブストローク（draw-live）の点列検証・整形

const { useRef, useEffect, useState, useImperativeHandle, forwardRef, useCallback } = React;

const DEFAULT_COLOR = '#ff3b30';
const DEFAULT_WIDTH = 6;
const WIDTH_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8]; // 太さのドロップダウン候補（スマホで選びやすい）
const ERASER_SCALE = 3;          // 消しゴム幅 = ペン幅 × 係数
const SEND_DEBOUNCE_MS = 140;    // 描画確定→送信のまとめ送り
const HISTORY_MAX = 40;          // undo スナップショット上限
const MAX_OBJECTS = 4000;        // rx 受信時の防御（無認証 WS の偽注入対策）
const FONT_FAMILY = "'Zen Maru Gothic', sans-serif";
const CURSOR_SEND_MS = 40;       // カーソル送信の間引き（約25fps）
const CURSOR_HIDE_MS = 4000;     // 受信が途切れたら残像を消す
const LIVE_ORPHAN_MS = 1500;     // ライブ終了後に確定(draw-scene)が来ないとき、残ったプレビューを消すまで

// 色/太さの簡易永続化（localStorage）。失敗は握りつぶす（描画機能の本質ではない）。
const LS_KEY = 'guruguru-draw';
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; }
}
function savePrefs(p) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(p)); } catch { /* noop */ }
}

function DrawLayerImpl(props, ref) {
  const { mode, showToolbar, active = true, toolbarDefaultStyle } = props; // mode: 'edit' | 'view'
  const isEdit = mode === 'edit';

  const { cursorOn = false } = props; // OBS にマウスカーソルを表示する（操作側→配信側へ送る）か
  // 最新のコールバックを ref で持つ（再購読せずに中身だけ差し替え）。
  const onSceneChangeRef = useRef(props.onSceneChange);
  onSceneChangeRef.current = props.onSceneChange;
  const onCursorMoveRef = useRef(props.onCursorMove);
  onCursorMoveRef.current = props.onCursorMove;
  const onDrawLiveRef = useRef(props.onDrawLive);
  onDrawLiveRef.current = props.onDrawLive;

  const containerRef = useRef(null);
  const canvasElRef = useRef(null);
  const fcRef = useRef(null);              // fabric.Canvas（edit）/ fabric.StaticCanvas（view）
  const lastSrcRef = useRef({ w: 0, h: 0 }); // view: 送信元キャンバスサイズ（VPT 算出用）
  const sendTimerRef = useRef(0);
  const historyRef = useRef([]);          // edit: scene JSON 文字列のスナップショット
  const suppressRef = useRef(false);      // load 中は変更通知を止める
  const eraserDisposerRef = useRef(null); // EraserBrush の 'end' リスナ解除関数
  const cursorElRef = useRef(null);       // view: 受信カーソルを描く DOM 要素
  const cursorHideTimerRef = useRef(0);   // view: 残像消し用タイマー
  const cursorPosRef = useRef({ x: 0, y: 0 }); // edit: 最新ポインタ位置
  const cursorSendTimerRef = useRef(0);   // edit: 送信間引きタイマー
  // edit(tx): 描画中ストロークのライブ送信状態。id=0 は非ストローク中。
  const liveTxRef = useRef({ id: 0, pts: [], sent: 0, pending: false, raf: 0 });
  // view(rx): 受信したライブストロークの一時プレビュー。1ストローク = Path 1本。
  const liveRxRef = useRef({ id: 0, pts: [], color: DEFAULT_COLOR, width: DEFAULT_WIDTH, path: null, endTimer: 0, raf: 0 });

  const prefs = loadPrefs();
  const [tool, setTool] = useState('off'); // 'off' | 'pen' | 'eraser' | 'select' | 'text'
  const [color, setColor] = useState(prefs.color || DEFAULT_COLOR);
  // 保存値が候補(1〜8)外（旧スライダーの最大40 等）なら既定へ寄せる。
  const [width, setWidth] = useState(WIDTH_OPTIONS.includes(prefs.width) ? prefs.width : DEFAULT_WIDTH);

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

  // view: 送信元(w,h)→自分(getWidth/Height)へ拡縮する viewportTransform を当てる。
  // X/Y を別倍率にすると tx と OBS の縦横比が違うとき絵が歪む（正方形が長方形になる）。
  // → 等倍スケール＋中央合わせにして縦横比を保つ。基準はアバターと同じ vmin(=短辺)。
  //    アバターは vmin・中央寄せでレイアウトされるので、同じ基準・中央で拡縮すると
  //    絵がアバター/シーンに追従しつつ歪まない。はみ出しは画面外へ（クリップ）。
  const applyVpt = useCallback(() => {
    const fc = fcRef.current;
    if (!fc) return;
    const { w, h } = lastSrcRef.current;
    if (!w || !h) return;
    const rw = fc.getWidth();
    const rh = fc.getHeight();
    const s = Math.min(rw, rh) / Math.min(w, h); // 等倍（vmin 基準）
    const e = rw / 2 - s * (w / 2); // 中央合わせ（X）
    const f = rh / 2 - s * (h / 2); // 中央合わせ（Y）
    fc.setViewportTransform([s, 0, 0, s, e, f]);
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

  // --- rx: ライブプレビュー（描画途中の一時 Path） -----------------------
  // 受信ごとに描かず rAF で1フレーム1回に集約する（メッセージ連打による描画増幅を抑える）。
  const renderLivePreview = useCallback(() => {
    const fc = fcRef.current;
    const L = liveRxRef.current;
    L.raf = 0;
    if (!fc) return;
    if (L.path) { try { fc.remove(L.path); } catch { /* noop */ } L.path = null; }
    if (!isRenderablePts(L.pts)) { fc.requestRenderAll(); return; }
    const pts = L.pts.map(([x, y]) => new fabric.Point(x, y));
    // 確定 PencilBrush と同じ平滑化＋端点補正(width/1000)で、置換時のスナップを抑える。
    const d = fabric.util.getSmoothPathFromPoints(pts, L.width / 1000);
    const path = new fabric.Path(d, {
      stroke: L.color, strokeWidth: L.width, fill: null,
      strokeLineCap: 'round', strokeLineJoin: 'round',
      selectable: false, evented: false, objectCaching: false,
    });
    L.path = path;
    fc.add(path);          // StaticCanvas は renderOnAddRemove:false なので…
    fc.requestRenderAll(); // …明示 render が必須
  }, []);

  const scheduleLiveRender = useCallback(() => {
    const L = liveRxRef.current;
    if (L.raf) return; // 1フレーム1描画に集約
    L.raf = requestAnimationFrame(renderLivePreview);
  }, [renderLivePreview]);

  // プレビューと予約をすべて畳む。確定 draw-scene 到着時・ストローク終了の保険で呼ぶ。
  const clearLivePreview = useCallback(() => {
    const fc = fcRef.current;
    const L = liveRxRef.current;
    clearTimeout(L.endTimer); L.endTimer = 0;
    if (L.raf) { cancelAnimationFrame(L.raf); L.raf = 0; }
    if (L.path && fc) { try { fc.remove(L.path); } catch { /* noop */ } fc.requestRenderAll(); }
    L.path = null; L.id = 0; L.pts = [];
  }, []);

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
    // ライブ状態オブジェクトは初回固定で再代入されない。effect 内で捕捉して cleanup でも同一参照を使う。
    const liveTx = liveTxRef.current;
    const liveRx = liveRxRef.current;

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

      // --- ライブ送信（描画中のペンストロークを rx へ。ペン限定） -------------
      // 生ポイントを getScenePoint で蓄積し、rAF で 1tick=1送信・増分のみ流す。
      // edit 側 VPT は恒等なので scenePoint＝ウィンドウ px（rx が同じ等倍マップで描く）。
      // 消しゴムは clipPath 加算方式で点列から再現できないためライブ非対応（確定のみ）。
      const live = liveTx;
      const liveFlush = () => {
        live.raf = 0;
        if (!live.id || !live.pending) return;
        const inc = live.pts.slice(live.sent);
        if (!inc.length) return;
        live.pending = false;
        live.sent = live.pts.length;
        onDrawLiveRef.current?.({ phase: 'move', id: live.id, pts: inc, w: fc.getWidth(), h: fc.getHeight() });
      };
      const scheduleLive = () => {
        if (live.raf) return;
        live.raf = requestAnimationFrame(liveFlush);
      };
      fc.on('mouse:down', (opt) => {
        if (!fc.isDrawingMode || toolRef.current !== 'pen') return; // ペン以外はライブ非対応
        const p = fc.getScenePoint(opt.e);
        live.id += 1; live.pts = [[Math.round(p.x), Math.round(p.y)]]; live.sent = 1; live.pending = false;
        onDrawLiveRef.current?.({
          phase: 'start', id: live.id, color: colorRef.current, width: widthRef.current,
          pts: live.pts.slice(), w: fc.getWidth(), h: fc.getHeight(),
        });
      });
      fc.on('mouse:move', (opt) => {
        if (!live.id || !fc.isDrawingMode) return;
        const p = fc.getScenePoint(opt.e);
        const x = Math.round(p.x);
        const y = Math.round(p.y);
        const last = live.pts[live.pts.length - 1];
        if (last && last[0] === x && last[1] === y) return; // 重複除去
        if (live.pts.length >= MAX_LIVE_PTS) return;          // 上限（暴走防御）
        live.pts.push([x, y]); live.pending = true;
        scheduleLive();
      });
      fc.on('mouse:up', () => {
        if (!live.id) return;
        liveFlush(); // 末尾の取りこぼしを送る
        onDrawLiveRef.current?.({ phase: 'end', id: live.id });
        live.id = 0; live.pts = []; live.sent = 0; live.pending = false;
        if (live.raf) { cancelAnimationFrame(live.raf); live.raf = 0; }
      });

      pushHistory(); // 初期スナップショット（空）
    }

    return () => {
      clearTimeout(sendTimerRef.current);
      if (eraserDisposerRef.current) { eraserDisposerRef.current(); eraserDisposerRef.current = null; }
      if (liveTx.raf) { cancelAnimationFrame(liveTx.raf); liveTx.raf = 0; }
      if (liveRx.raf) { cancelAnimationFrame(liveRx.raf); liveRx.raf = 0; }
      clearTimeout(liveRx.endTimer); liveRx.endTimer = 0; liveRx.path = null;
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
      // 確定シーン到着 → ライブプレビューを即破棄（loadFromJSON は非同期なので同期で消す）。
      clearLivePreview();
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
    // rx: 受信したカーソル位置を、描画と同じ等倍＋中央マップで表示する。
    setCursor(data) {
      const el = cursorElRef.current;
      const fc = fcRef.current;
      if (!el) return;
      const x = Number(data && data.x);
      const y = Number(data && data.y);
      const w = Number(data && data.w);
      const h = Number(data && data.h);
      const ok = data && data.show !== false && fc
        && [x, y, w, h].every(Number.isFinite) && w > 0 && h > 0;
      if (!ok) { el.style.display = 'none'; clearTimeout(cursorHideTimerRef.current); return; }
      const W = fc.getWidth();
      const H = fc.getHeight();
      const s = Math.min(W, H) / Math.min(w, h);   // 描画と同じ vmin 等倍
      el.style.left = `${s * x + (W / 2 - s * w / 2)}px`;
      el.style.top = `${s * y + (H / 2 - s * h / 2)}px`;
      el.style.display = 'block';
      clearTimeout(cursorHideTimerRef.current);
      cursorHideTimerRef.current = setTimeout(() => {
        if (cursorElRef.current) cursorElRef.current.style.display = 'none';
      }, CURSOR_HIDE_MS);
    },
    // rx: 描画途中のライブストロークを一時 Path で表示する。確定 draw-scene が来たら loadScene が置換。
    // 無認証 WS 前提で点列・色・太さ・id を検証してから描く（偽注入・暴走対策）。
    setLive(data) {
      const fc = fcRef.current;
      if (!fc || mode !== 'view' || !data || typeof data !== 'object') return;
      const L = liveRxRef.current;
      if (data.phase === 'start') {
        clearLivePreview();                        // 前ストロークの残骸を掃除
        L.id = Number(data.id) || 1;
        L.pts = sanitizeLivePoints(data.pts);
        L.color = sanitizeLiveColor(data.color);
        L.width = clampLiveWidth(data.width);
        lastSrcRef.current = {
          w: Number(data.w) || fc.getWidth(),
          h: Number(data.h) || fc.getHeight(),
        };
        applyVpt();                                // 確定線と同じ vmin 中央マップに合わせる
        scheduleLiveRender();
      } else if (data.phase === 'move') {
        if (Number(data.id) !== L.id) return;      // id 不一致は無視（古い/別ストローク）
        const inc = sanitizeLivePoints(data.pts);
        if (!inc.length) return;
        if (L.pts.length + inc.length > MAX_LIVE_PTS) return; // 上限超過は無視（暴走防御）
        for (const p of inc) L.pts.push(p);
        scheduleLiveRender();
      } else if (data.phase === 'end') {
        if (Number(data.id) !== L.id) return;
        // 確定 draw-scene が間もなく来て loadScene が掃除する。来なければ保険で自分で消す。
        clearTimeout(L.endTimer);
        L.endTimer = setTimeout(clearLivePreview, LIVE_ORPHAN_MS);
      }
    },
    clear: doClear,
    undo: doUndo,
  }), [applyScene, serialize, doClear, doUndo, applyVpt, clearLivePreview, scheduleLiveRender, mode]);

  // お絵かき OFF（active=false）にしたら道具を「手」に戻す（入力を下のアバターへ通す）。
  useEffect(() => {
    if (isEdit && !active) setTool('off');
  }, [isEdit, active]);

  // 操作側(edit): カーソル ON のとき、ウィンドウのポインタ位置を間引いて配信側へ送る。
  // 送る座標は描画と同じ「キャンバス＝ウィンドウ px」。rx 側が同じ等倍マップで表示する。
  useEffect(() => {
    if (!isEdit) return undefined;
    if (!cursorOn) {
      onCursorMoveRef.current?.({ show: false }); // OFF にしたら残像を消す
      return undefined;
    }
    const flush = () => {
      cursorSendTimerRef.current = 0;
      const { x, y } = cursorPosRef.current;
      onCursorMoveRef.current?.({ x, y, w: window.innerWidth, h: window.innerHeight, show: true });
    };
    const onMove = (e) => {
      cursorPosRef.current = { x: e.clientX, y: e.clientY };
      if (!cursorSendTimerRef.current) cursorSendTimerRef.current = setTimeout(flush, CURSOR_SEND_MS);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (cursorSendTimerRef.current) { clearTimeout(cursorSendTimerRef.current); cursorSendTimerRef.current = 0; }
      onCursorMoveRef.current?.({ show: false }); // 抜けるとき消す
    };
  }, [isEdit, cursorOn]);

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
      {/* view(rx/OBS): 受信したマウスカーソル。先端が指定座標に来るよう左上原点で置く。 */}
      {!isEdit ? (
        <div
          ref={cursorElRef}
          aria-hidden="true"
          style={{ position: 'absolute', left: 0, top: 0, display: 'none', pointerEvents: 'none', zIndex: 7, willChange: 'left, top' }}
        >
          <svg width="26" height="26" viewBox="0 0 24 24" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))' }}>
            <path d="M1 1 L1 18 L5.4 13.8 L8.6 21 L11.5 19.8 L8.3 12.8 L15 12.8 Z" fill="#fff" stroke="#000" strokeWidth="1.4" strokeLinejoin="round" />
          </svg>
        </div>
      ) : null}
      {showToolbar ? (
        <DrawToolbar
          tool={tool} setTool={setTool}
          color={color} onColor={onPickColor}
          width={width} onWidth={onPickWidth}
          onClear={doClear}
          onUndo={doUndo}
          defaultStyle={toolbarDefaultStyle}
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

const TOOLBTN_STYLE = (on) => ({
  flex: '0 0 auto', // 横スクロール内で縮ませない（潰さず溢れさせてスクロール）
  border: 'none', borderRadius: 7, cursor: 'pointer',
  padding: '5px 9px', fontSize: 12, fontWeight: 700,
  background: on ? '#3b74e8' : 'rgba(255,255,255,0.14)', color: '#fff',
});

const DEFAULT_TOOLBAR_POS = { top: 10, left: '50%', transform: 'translateX(-50%)' };

function DrawToolbar({ tool, setTool, color, onColor, width, onWidth, onClear, onUndo, defaultStyle }) {
  // DraggablePanel で掴んで移動（位置は localStorage に永続化・ダブルクリックで戻す）。
  // 左端に固定のドラッグハンドル、その右に操作子の横スクロール帯（演出帯と同じ cuebar-scroll）。
  // パネルは maxWidth で画面幅に収め、はみ出す操作子は横ドラッグでスライドできる。
  return (
    <DraggablePanel
      id="draw-toolbar"
      resizable={false}
      defaultStyle={defaultStyle || DEFAULT_TOOLBAR_POS}
      style={{
        zIndex: 7, pointerEvents: 'auto',
        // 親 touch-action:none を解除（中の帯を横スクロールできるように。ハンドルは個別に none）。
        touchAction: 'auto',
        display: 'flex', gap: 6, alignItems: 'stretch',
        padding: 5, background: 'rgba(30,30,34,0.9)', color: '#fff',
        borderRadius: 10, fontSize: 12, fontFamily: FONT_FAMILY,
        boxShadow: '0 4px 16px rgba(0,0,0,0.3)', userSelect: 'none',
        // 見切れ防止: 画面幅に収める。はみ出しは中の帯を横スクロール。
        maxWidth: 'calc(100vw - 16px)', boxSizing: 'border-box',
      }}
    >
      {/* ドラッグ専用ハンドル（固定・つかみやすい領域）。data-no-drag を付けないのでここで掴める。 */}
      <div
        title="ドラッグで移動（ダブルクリックで位置を戻す）"
        style={{
          flex: '0 0 auto',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'move', touchAction: 'none', padding: '0 8px',
          borderRadius: 7, background: 'rgba(255,255,255,0.16)',
          fontSize: 16, lineHeight: 1, letterSpacing: 1, color: 'rgba(255,255,255,0.85)',
        }}
      >⠿</div>
      {/* 操作子: 横スクロール帯。ドラッグ対象外(data-no-drag)で、横ドラッグはスクロールに使う。 */}
      <div
        className="cuebar-scroll"
        data-no-drag
        onDoubleClick={(e) => e.stopPropagation()}
        style={{
          flex: '1 1 auto', minWidth: 0,
          display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'nowrap',
          overflowX: 'auto', overflowY: 'hidden', touchAction: 'pan-x',
          WebkitOverflowScrolling: 'touch', overscrollBehaviorX: 'contain', overscrollBehaviorY: 'none',
          padding: '1px 2px',
        }}
      >
        {TOOL_BTNS.map((b) => (
          <button key={b.id} onClick={() => setTool(b.id)} style={TOOLBTN_STYLE(tool === b.id)}>{b.label}</button>
        ))}
        <input
          type="color" value={color} onChange={(e) => onColor(e.target.value)}
          title="色" aria-label="色"
          style={{ flex: '0 0 auto', width: 28, height: 26, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
        />
        <select
          value={WIDTH_OPTIONS.includes(width) ? width : DEFAULT_WIDTH}
          onChange={(e) => onWidth(Number(e.target.value))}
          title="太さ" aria-label="太さ"
          style={{
            flex: '0 0 auto', height: 28, borderRadius: 7, cursor: 'pointer',
            border: 'none', padding: '0 6px', fontSize: 12, fontWeight: 700,
            background: 'rgba(255,255,255,0.16)', color: '#fff',
          }}
        >
          {WIDTH_OPTIONS.map((n) => (
            <option key={n} value={n} style={{ color: '#000', background: '#fff' }}>太さ {n}</option>
          ))}
        </select>
        <button onClick={onUndo} style={TOOLBTN_STYLE(false)}>戻す</button>
        <button onClick={onClear} style={{ ...TOOLBTN_STYLE(false), background: 'rgba(229,72,77,0.85)' }}>全消し</button>
      </div>
    </DraggablePanel>
  );
}

export const DrawLayer = forwardRef(DrawLayerImpl);
