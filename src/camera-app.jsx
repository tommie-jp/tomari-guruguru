import React from 'react';
import ReactDOM from 'react-dom/client';
import charConfig, { avatars, getAvatar } from './character-config';
import { parseCameraParam, resolveCameraDevice, formatCameraLabel } from './camera-config';
import { useFacePose } from './face/use-face-pose';
import { parseObsParams } from './obs-mode';
import { parseRelayMode } from './relay-mode';
import { computeStateFrame, createExprState } from './face/avatar-state';
import { computeDirectionRange } from './face/direction-range';
import {
  computeSlidePoseCompX, computeSlidePoseCompY, computeZoomPitchComp, computeTiltYawComp,
} from './face/calibrate-comp';
import { compensateScaleForMouth } from './face/mouth-compensated-scale';
import { applyState, createSmoothState } from './face/apply-state';
import { encodeStateFrame, decodeStateFrame } from './face/state-codec';
import { useRelay } from './face/use-relay';
import { DraggablePanel } from './draggable-panel.jsx';
import { SpriteAvatar } from './sprite-avatar';
import { QRCodeSVG } from 'qrcode.react';
import { installMobileHardening } from './mobile-hardening.js';
import { applyThemeColor } from './theme-color.js';
import { createSoundboard } from './cue-audio.js';
import { createCueController, isTypingTarget, parseCueParam } from './cue-system.js';
import { CueStampLayer } from './cue-stamp.jsx';
import { GESTURES, sampleGesture, gestureTransform } from './gestures.js';

const { useState, useEffect, useRef, useMemo } = React;

// バージョン表記。vite.fork.js の define でビルド時に静的置換される。
// build: "v1.0.0 · f7efa25 · 2026-06-17" / dev: "v1.0.0 · dev"。
// define が効かない環境（万一）でも落ちないよう typeof でガードする。
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
const GIT_SHA = typeof __GIT_SHA__ !== 'undefined' ? __GIT_SHA__ : 'dev';
const BUILD_DATE = typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : 'dev';
const VERSION_LABEL =
  GIT_SHA === 'dev'
    ? `v${APP_VERSION} · dev`
    : `v${APP_VERSION} · ${GIT_SHA} · ${BUILD_DATE}`;
// 狭い画面用の短縮版（日付を落としてビルド識別だけ残す）。右下 Tweaks ボタンの上に
// 1行で収め、左下コントロールに被らない長さにする。
const VERSION_LABEL_SHORT =
  GIT_SHA === 'dev' ? `v${APP_VERSION} · dev` : `v${APP_VERSION} · ${GIT_SHA}`;

// アプリ内 QR が指す iPhone(tx) URL。vite.fork.js が __TX_PUBLIC_ORIGIN__ に外部到達可能な
// 公開オリジン（tailscale 証明書名 → https://FQDN:5173）を注入する。無ければ現在開いている
// オリジン（tailscale URL で開いていればそれで正しい）。パスは BASE_URL を尊重するので
// GitHub Pages の /guruguru-avatar/ サブパスでも壊れない。
const TX_PUBLIC_ORIGIN =
  (typeof __TX_PUBLIC_ORIGIN__ !== 'undefined' && __TX_PUBLIC_ORIGIN__) ||
  (typeof location !== 'undefined' ? location.origin : '');
const TX_URL = `${TX_PUBLIC_ORIGIN}${import.meta.env.BASE_URL}index.html?tx`;

// 配布デフォルト値。旧 default-themes/camera.html.json の "01-for-PC(Default)" を
// 取り込んだもの（showDebug/showExpr のみ配信向けに OFF）。現行 index.html 構成では
// seed 用 JSON が無くてもこのハードコード値が初期テーマとして効く（iPhone 等の初回
// アクセスでもテーマが当たる）。配布テーマを足したい場合は public/default-themes/
// index.json を置けば上に重なる（fetchBuiltinPresets / 読込失敗は console に出る）。
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "avatarId": "01-tomari",
  "smoothing": 0.3,
  "sensitivity": 1.3,
  "biasYawDeg": -8,
  "biasPitchDeg": -10,
  "rangeYawLeftDeg": 28.6,
  "rangeYawRightDeg": 28.6,
  "rangePitchUpDeg": 22.9,
  "rangePitchDownDeg": 22.9,
  "invertX": true,
  "invertY": false,
  "preview": true,
  "mouthGain": 1.8,
  "thHalf": 0.12,
  "thFull": 0.35,
  "release": 0.25,
  "blinkSync": true,
  "blinkSensitivity": 1.0,
  "eyesOpenBias": 0.44,
  "tiltEnabled": true,
  "tiltGain": 1.3,
  "tiltMax": 23,
  "tiltPivotY": 72,
  "invertTilt": false,
  "tiltYawComp": 0,
  "biasRollDeg": 0,
  "slideEnabled": true,
  "slideGain": 12,
  "slideMax": 30,
  "invertSlide": true,
  "slideGainY": 8,
  "slideMaxY": 25,
  "invertSlideY": false,
  "slidePoseCompX": 0.6,
  "slidePoseCompY": 0.6,
  "zoomEnabled": true,
  "zoomGain": 1.4,
  "zoomMin": 0.35,
  "zoomMax": 1.5,
  "zoomPitchComp": 1.0,
  "zoomMouthComp": 0,
  "zoomBaseline": 0.387,
  "motionSmoothing": 0.2,
  "moveRatio": 1.0,
  "userZoomMin": 0.3,
  "userZoomMax": 4,
  "wheelZoomDial": 30,
  "charSize": 39,
  "shadow": 3,
  "bgColor": "#EEF4FB",
  "showDebug": false,
  "showExpr": false,
  "showCalib": false,
  "cameraLabel": "",
  "facingMode": "user",
  "useWorker": true,
  "effGlow": false,
  "effGlowStrength": 3,
  "effGlowColor": "#9FD8FF",
  "effDissolve": false,
  "effDissolveAmount": 0,
  "effDissolveColor": "#7FE0FF",
  "sbGain": 1,
  "sbButtons": true
}/*EDITMODE-END*/;

// 表示する主な表情ブレンドシェイプ（MediaPipe FaceLandmarker のカテゴリ名）
const MAIN_BLENDSHAPES = [
  { key: 'jawOpen', label: '口の開き' },
  { key: 'mouthSmileLeft', label: '笑み左' },
  { key: 'mouthSmileRight', label: '笑み右' },
  { key: 'mouthPucker', label: '口すぼめ' },
  { key: 'browInnerUp', label: '眉内上げ' },
  { key: 'browDownLeft', label: '眉下げ左' },
  { key: 'browDownRight', label: '眉下げ右' },
  { key: 'eyeBlinkLeft', label: 'まばたき左' },
  { key: 'eyeBlinkRight', label: 'まばたき右' },
  { key: 'eyeWideLeft', label: '目見開き左' },
  { key: 'eyeWideRight', label: '目見開き右' },
  // cheekPuff(頬ふくらみ)は MediaPipe モデルがほぼ反応しないため、確実に動く
  // cheekSquint(笑う/目を細めると頬が上がる)に差し替え。
  { key: 'cheekSquintLeft', label: '頬上げ左' },
  { key: 'cheekSquintRight', label: '頬上げ右' },
];

// 顔推定ドライバが扱うグリッド（左右5×上下5＝25方向）。全アバター共通の表情グリッド。
const { rows: ROWS, cols: COLS } = charConfig;

// ?avatar=<id> を読む。未指定・未知 id は null（＝保存値/既定に従う）。
// OBS シーンごとにアバターを URL で固定したいとき用（セレクタより優先する）。
function parseAvatarParam(search) {
  try {
    const id = new URLSearchParams(search).get('avatar');
    return id && avatars.some((a) => a.id === id) ? id : null;
  } catch {
    return null;
  }
}

const BG_OPTIONS = ['#FFF8EE', '#FDEFEF', '#EEF4FB', '#2B2926'];
// エフェクトの色プリセット（発光／ディゾルブ縁）。
const GLOW_COLORS = ['#9FD8FF', '#FFD27A', '#FF8FB1', '#B6FF9F'];
const DISSOLVE_COLORS = ['#7FE0FF', '#FFB04D', '#C792FF', '#7CFFB0'];

// 影レベル(0~6, tweak `shadow`)→ CSS filter。大きいほど濃く広く広がる。0 は影なし。
// 高レベルでは「広いぼかし影＋細い輪郭影」を重ねて、透過背景でもはっきり立たせる。
// 4~6 は旧 ?shadow=3 より大きく広げた追加レンジ（Tweaks のスライダーで選ぶ）。
const SHADOW_FILTERS = [
  undefined,                                                                          // 0 なし
  'drop-shadow(0 2px 6px rgba(0,0,0,0.35))',                                           // 1
  'drop-shadow(0 5px 13px rgba(0,0,0,0.45)) drop-shadow(0 0 2px rgba(0,0,0,0.4))',     // 2
  'drop-shadow(0 10px 24px rgba(0,0,0,0.62)) drop-shadow(0 0 5px rgba(0,0,0,0.55))',   // 3
  'drop-shadow(0 16px 36px rgba(0,0,0,0.66)) drop-shadow(0 0 8px rgba(0,0,0,0.6))',    // 4
  'drop-shadow(0 24px 52px rgba(0,0,0,0.7)) drop-shadow(0 0 12px rgba(0,0,0,0.62))',   // 5
  'drop-shadow(0 34px 72px rgba(0,0,0,0.74)) drop-shadow(0 0 18px rgba(0,0,0,0.66))',  // 6 最大幅
];
// 影レベルの最大値（SHADOW_FILTERS の最後のインデックス）。スライダー上限とクランプに使う。
const SHADOW_MAX = SHADOW_FILTERS.length - 1;

const DEG = Math.PI / 180;
// 方向校正(上下左右)で受け付ける最小の振り角(度・物理角)。これ未満や逆向きは
// 「ちゃんと振り向いていない」とみなして弾く（direction-range.js が判定）。
const CALIBRATE_MIN_SWING_DEG = 5;

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

// アバターのユーザー操作（ドラッグ移動・ホイール/ピンチでズーム）の範囲と感度。
// 顔追従とは独立した「表示上の」調整なので relay には送らずローカルのみで完結する。
// 実値は Tweaks（userZoomMin/userZoomMax/wheelZoomDial）から毎イベント読んでリアルタイムに
// 効かせる。以下の定数は保存値が無いとき／旧テーマ用の「フォールバック既定」として残す。
const USER_ZOOM_MIN = 0.3;
const USER_ZOOM_MAX = 4;
const DRAG_SQUISH_CANCEL_PX = 4;    // この距離以上動いたら押下スケールを解除しドラッグ扱い

// ホイール感度は UI 上「0〜100」のダイヤルで持ち、exp の係数へ線形変換する。
// ダイヤル100 で WHEEL_SENS_MAX、0 で 0（＝ホイールズーム無効）。既定30 ≒ 旧 0.0015。
const WHEEL_SENS_MAX = 0.005;
const WHEEL_SENS_DIAL_DEFAULT = 30;
function wheelSensFromDial(dial) {
  const d = Math.min(100, Math.max(0, dial));
  return (d / 100) * WHEEL_SENS_MAX;
}

// 十字校正ボタンを押した後、ボタン上に確認表示（✓ / ✗）を出す時間(ms)。
// 校正は値の変化が控えめで効いたか分かりにくいため、短く効果を知らせる。
const CALIBRATE_FEEDBACK_MS = 1400;

// 移動の tx→rx 比率（rx の移動量 = tx の移動量 × moveRatio）。スライダーの範囲。
const MOVE_RATIO_MIN = 0.1;
const MOVE_RATIO_MAX = 3.0;

// ユーザー操作2層（shared+local）→ userRef へ書く transform 文字列。
// 移動は加算(vw/vh)、ズームは乗算(倍率)。effect とボタンの両方から使う（式の一元化）。
function composeUserTransform(u) {
  const x = (u.shared.x + u.local.x).toFixed(2);
  const y = (u.shared.y + u.local.y).toFixed(2);
  const z = (u.shared.zoom * u.local.zoom).toFixed(3);
  return `translate(${x}vw, ${y}vh) scale(${z})`;
}

// 狭い画面（スマホのポートレイト）か。下部コントロールを小型化し、中央タイトル帯・
// 右下 Tweaks と重ならないレイアウトに切り替えるのに使う。Tweaks パネルの CSS と
// 同じ 480px をブレークポイントにする（tweaks-panel.jsx の @media と揃える）。
const NARROW_QUERY = '(max-width: 480px)';
function useIsNarrow() {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia(NARROW_QUERY).matches,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(NARROW_QUERY);
    const onChange = (e) => setNarrow(e.matches);
    setNarrow(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return narrow;
}

// アプリ内 QR ボタン。クリックで iPhone(tx) URL の QR をポップオーバー表示する。
// tailscale の長い URL を手入力せず、iPhone のカメラで読み取って tx を開けるようにする。
// 配信(obsMode)中は呼び出し側で隠す。url は外部端末から到達できる公開 URL（TX_URL）。
function TxQrButton({ url, subColor, inkColor, style }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'absolute', pointerEvents: 'auto', ...style }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          background: 'none', border: 'none', padding: 0, cursor: 'pointer',
          font: 'inherit', fontSize: 14, fontWeight: 700, letterSpacing: '0.06em',
          color: open ? inkColor : subColor,
        }}
      >{`QRコード ${open ? '▲' : '▼'}`}</button>
      {open && (
        <div style={{
          position: 'absolute', top: 24, right: 0, zIndex: 40,
          background: '#fff', borderRadius: 12, padding: 12, width: 256,
          boxShadow: '0 8px 28px rgba(0,0,0,0.28)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
        }}>
          <QRCodeSVG value={url} size={232} level="M" marginSize={2}
            bgColor="#ffffff" fgColor="#1a1410" />
          <div style={{ fontSize: 13, fontWeight: 700, color: '#3c3026', letterSpacing: '0.04em', textAlign: 'center' }}>
            iPhone のカメラで読み取り → tx を開く
          </div>
          <code style={{
            fontSize: 11, lineHeight: 1.4, color: '#6a5a48',
            wordBreak: 'break-all', textAlign: 'center', userSelect: 'all',
          }}>{url}</code>
        </div>
      )}
    </div>
  );
}

// 上下左右＋正面の十字校正ボタン。各方向に顔を振り切って押すと、その向きの
// 振り幅を校正する（中央=正面）。flash[dir] が 'ok'/'err' のときボタン上に ✓/✗ を出す。
// スマホでも押しやすいよう各マスは最小 56px、文字は clamp で可変にする。
function DirectionCross({ flash = {}, onDir, onCenter }) {
  const CELL = {
    border: 'none', borderRadius: 12, cursor: 'pointer',
    color: '#fff', fontWeight: 800, letterSpacing: '0.06em',
    fontFamily: "'Zen Maru Gothic', sans-serif",
    fontSize: 'clamp(15px, 4.2vmin, 19px)', minHeight: 56, padding: '10px 0',
    boxShadow: '0 2px 8px rgba(0,0,0,0.18)', transition: 'background 0.2s ease',
  };
  const bgFor = (st) => (st === 'ok' ? '#46C26A' : st === 'err' ? '#D9534F' : '#E8923C');
  const textFor = (st, label) => (st === 'ok' ? '✓' : st === 'err' ? '✗' : label);
  const cell = (dir, label, area, onClick, title) => {
    const st = flash[dir];
    return (
      <button type="button" onClick={onClick} title={title}
        style={{ ...CELL, gridArea: area, background: bgFor(st) }}>{textFor(st, label)}</button>
    );
  };
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8,
      gridTemplateAreas: '". up ." "left center right" ". down ."',
      maxWidth: 240, margin: '6px auto 2px',
    }}>
      {cell('up', '上', 'up', () => onDir('up'), '顔を上に向け切って押す（上端に校正）')}
      {cell('left', '左', 'left', () => onDir('left'), '顔を左に向け切って押す（左端に校正）')}
      {cell('center', '正', 'center', onCenter, '向き・距離・目・かしげをまとめて校正（旧「校正」ボタン）')}
      {cell('right', '右', 'right', () => onDir('right'), '顔を右に向け切って押す（右端に校正）')}
      {cell('down', '下', 'down', () => onDir('down'), '顔を下に向け切って押す（下端に校正）')}
    </div>
  );
}

// パネルの表示/非表示をワンタップで切り替えるチップ列（Tweaks を開かずに各 HUD を出せる）。
// on のチップは緑枠で強調。items=[{ key, label, on, toggle }]。
function PanelToggles({ items, inkColor, subColor, style, children }) {
  return (
    <div style={{
      position: 'absolute', zIndex: 6, display: 'flex', gap: 6, flexWrap: 'wrap',
      alignItems: 'center', fontFamily: "'Zen Maru Gothic', sans-serif", ...style,
    }}>
      {items.map(({ key, label, on, toggle }) => (
        <button
          key={key}
          type="button"
          onClick={toggle}
          aria-pressed={on}
          title={`${label}を${on ? '隠す' : '表示'}`}
          style={{
            display: 'inline-flex', alignItems: 'center', lineHeight: 1,
            padding: '4px 10px', borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap',
            border: `1.5px solid ${on ? '#46C26A' : 'rgba(127,127,127,0.45)'}`,
            background: on ? 'rgba(70,194,106,0.16)' : 'transparent',
            color: on ? inkColor : subColor, fontSize: 13, fontWeight: 700, letterSpacing: '0.03em',
          }}
        >{label}</button>
      ))}
      {children}
    </div>
  );
}

// 演出キュー: 音(tone は合成音フォールバック / sound にパスがあればそれを再生)とスタンプを束ねる。
// 発火経路は 右端ボタン / 数字キー / ?cue= の3つ共通。後で effect/expression も同じ cue に足せる。
const DEFAULT_CUES = [
  { id: 'hello',    label: 'こんにちは', key: '1', tone: 660, stamp: 'こんにちは！', anim: 'pop', icon: '👋', effect: { glow: 4, glowColor: '#9FD8FF', ms: 600 }, gesture: 'nod', place: 'above' },
  { id: 'clap',     label: '拍手',       key: '2', tone: 520, stamp: '👏', anim: 'pop' },
  { id: 'laugh',    label: 'わらい',     key: '3', tone: 720, stamp: '😆', anim: 'rise' },
  { id: 'sweat',    label: 'あせ',       key: '4', tone: 430, stamp: '💦', anim: 'rise' },
  { id: 'anger',    label: 'いかり',     key: '5', tone: 300, stamp: '💢', anim: 'shake', effect: { glow: 5, glowColor: '#FF6B6B', ms: 500 } },
  { id: 'sparkle',  label: 'キラキラ',   key: '6', tone: 880, stamp: '✨', anim: 'rise', effect: { glow: 7, glowColor: '#FFE9A8', ms: 850 }, gesture: 'spin' },
  { id: 'question', label: 'はてな',     key: '7', tone: 600, stamp: '！？', anim: 'pop', gesture: 'shake' },
];

function App() {
  const [t, setTweak, resetTweaks, themes] = useTweaks(TWEAK_DEFAULTS);
  // OBS ブラウザソース用ステージモード（背景透過＋UI 非表示）。
  // URL は起動時に固定なので一度だけ解析する。
  const stage = useMemo(
    () => parseObsParams(typeof window !== 'undefined' ? window.location.search : ''),
    [],
  );
  // WS 中継の役割（local / tx=送信側 / rx=受信側）。URL は起動時固定なので一度だけ解析。
  const relay = useMemo(
    () => parseRelayMode(
      typeof window !== 'undefined' ? window.location.search : '',
      typeof window !== 'undefined' ? window.location : {},
    ),
    [],
  );
  const mode = relay.mode;
  const isRx = mode === 'rx';
  // ステージモードの既定: obs 未指定なら rx のときだけ ON（rx=OBS の CEF 用なので透過が既定）。
  // ?obs=1 で常時 ON、?obs=0 で常時 OFF（rx をブラウザのタブでデバッグするとき用）。
  const obsMode = stage.obs ?? isRx;
  const [panelOpen, setPanelOpen] = useState(false); // obsMode 中に T キーで Tweaks を開閉
  // rx は受信した設定で描画し、それ以外はローカルの tweaks を使う。
  const [rxConfig, setRxConfig] = useState(TWEAK_DEFAULTS);
  // 接続中のカメラ一覧（[{deviceId,label}]）。カメラ許可後に列挙して埋める（下の effect）。
  const [cameras, setCameras] = useState([]);
  const view = isRx ? rxConfig : t;
  // 演出（サウンドボード＋リアクションスタンプ）。発火は ボタン/数字キー/?cue= 共通。
  // tx では発火を relay 経由で rx(OBS) にも転送し、本番オーバーレイに演出を出す。
  const cueBoard = useMemo(() => createSoundboard(), []);
  const cueStampRef = useRef(null);
  const cueSendRef = useRef(null); // relayApi.sendCue を後で差す（render 末で代入）
  const [cueFx, setCueFx] = useState(null); // 演出の一時エフェクト（グローのフラッシュ）
  const cueFxTimerRef = useRef(0);
  const gesturePlayRef = useRef(null); // 再生中ジェスチャー { name, start, base }（描画ループが読む）
  const gestureFxRef = useRef(null);   // 回転/拡縮を当てる中心原点ラッパー（顔追従と別レイヤー）
  const cueController = useMemo(
    () => createCueController(DEFAULT_CUES, (cue) => {
      cueBoard.play(cue);
      if (cueStampRef.current) cueStampRef.current.pop(cue);
      // effect 付きキューは一定時間だけグローを強める（音＋スタンプ＋発光の複合演出）。
      if (cue.effect) {
        clearTimeout(cueFxTimerRef.current);
        setCueFx(cue.effect);
        cueFxTimerRef.current = setTimeout(() => setCueFx(null), cue.effect.ms || 700);
      }
      // gesture 付きキューは うなずき/回転/いやいや を再生（描画ループが顔追従を一時上書き）。
      if (cue.gesture && GESTURES[cue.gesture]) {
        gesturePlayRef.current = { name: cue.gesture, start: performance.now(), base: null };
      }
      if (mode === 'tx' && cueSendRef.current) cueSendRef.current(cue.id);
    }),
    [cueBoard, mode],
  );
  useEffect(() => () => clearTimeout(cueFxTimerRef.current), []); // アンマウント時にタイマ掃除
  // 表示アバター。?avatar=<id> があれば最優先（OBS シーン固定）、無ければ tweaks の値。
  // URL は起動時固定なので一度だけ解析する。未知 id は getAvatar が既定へフォールバック。
  const avatarParam = useMemo(
    () => parseAvatarParam(typeof window !== 'undefined' ? window.location.search : ''),
    [],
  );
  const avatar = getAvatar(avatarParam ?? view.avatarId);
  const avatarId = avatar.id;
  // 使用カメラ。?camera=<ラベル|番号> があれば最優先（OBS シーン固定）、無ければ保存値 t.cameraLabel。
  // 一覧(cameras)はカメラ許可後に列挙する（下の effect）。deviceId はそこから純関数で解決する。
  const cameraParam = useMemo(
    () => parseCameraParam(typeof window !== 'undefined' ? window.location.search : ''),
    [],
  );
  // 前面/背面トグルを出すかの判定（モバイルのみ）。タッチ可 or モバイル UA。
  const isMobile = useMemo(
    () => typeof navigator !== 'undefined'
      && (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || navigator.maxTouchPoints > 0),
    [],
  );
  const cameraLabelEff = cameraParam ?? t.cameraLabel;
  // 解決済み deviceId（文字列 or null）。値が変わったときだけ useFacePose がカメラを取り直す。
  const deviceId = useMemo(
    () => resolveCameraDevice(cameras, cameraLabelEff),
    [cameras, cameraLabelEff],
  );
  // セレクタの選択肢（参照安定のため memo 化）。ラベルが取れたカメラのみ。
  const cameraOptions = useMemo(
    () => [
      { value: '', label: '自動（既定）' },
      ...cameras
        .filter((d) => d.label)
        .map((d, i) => ({ value: d.label, label: formatCameraLabel(d.label, i) })),
    ],
    [cameras],
  );
  // 保存ラベルのカメラが今は無い（消失・名前変更）ときは、表示上「自動（既定）」に落として
  // select が空欄にならないようにする（実際の解決は cameraLabelEff→deviceId が担う）。
  const cameraSelectValue = cameras.some((d) => d.label === t.cameraLabel) ? t.cameraLabel : '';
  // A〜F の6シートURL。アバターが変わったときだけ作り直す（参照安定＝再マウントのキーに使う）。
  const sheetUrls = useMemo(() => avatar.sheetUrls(), [avatarId]);
  // rx はカメラを持たないのでプレビュー無し。
  const showPreview = view.preview && !obsMode && !isRx; // 配信にカメラ枠を出さない
  const [cell, setCell] = useState({ r: 2, c: 2 });
  const [pressed, setPressed] = useState(false);
  // 十字（上/左/正/右/下）の校正ボタンごとのフィードバック。成功は 'ok'、振り不足や
  // 逆向きは 'err' を一定時間出す。方向ごとに別タイマーで消す。
  const [dirFlash, setDirFlash] = useState({});
  const dirFlashTimersRef = useRef({});
  // スマホ用「反映先」トグル。ON のとき操作は local 層（この端末だけ・CEF へ送らない）。
  // PC は Shift キーでも同じ層に切り替わる（layerFor が OR で見る）。ref は effect から参照。
  const [localMode, setLocalMode] = useState(false);
  const localModeRef = useRef(false);
  localModeRef.current = localMode;
  const [sheet, setSheet] = useState(0);    // 表示シート(0..5 = A..F)。apply-state が決める
  const [exprValues, setExprValues] = useState([]); // 表情係数パネル表示用
  const [cueAssigned, setCueAssigned] = useState(() => new Set()); // 音割当済みキューid
  const stageRef = useRef(null);
  const charRef = useRef(null);
  const motionRef = useRef(null);           // 首かしげ・スライド(translate)を直書きするラッパー
  const zoomRef = useRef(null);             // ズーム(scale)を直書きする外側ラッパー
  const userRef = useRef(null);             // ユーザー操作(ドラッグ移動・ズーム)を直書きする最外ラッパー
  // ユーザー操作は2層。shared は CEF(rx) へ送って同調させる分、local は Shift 併用で
  // 「この端末の見え方」だけ変える分（送らない）。表示は両者の合成（移動=加算/ズーム=乗算）。
  const userTransform = useRef({
    shared: { x: 0, y: 0, zoom: 1 }, // CEF へ送る（vw/vh + 倍率）
    local: { x: 0, y: 0, zoom: 1 },  // この端末だけ（送らない）
  });
  const target = useRef({ x: 0, y: 0 });   // -1..1（顔向きが書き込む）
  // 時間方向の状態（口エンベロープ・まばたきヒステリシス・ズーム自動基準）→ avatar-state が更新。
  const exprStateRef = useRef(createExprState());
  // 平滑化エンベロープ（向き・かしげ・スライド・ズーム）→ apply-state が更新。
  const smoothStateRef = useRef(createSmoothState());
  const autoBlinkRef = useRef(false);       // blinkSync OFF 時の自動まばたき状態（computeStateFrame に渡す）
  const latestFrameRef = useRef(null);      // rx: 最後に受信した状態フレーム
  const tweaksRef = useRef(t);
  tweaksRef.current = t;
  // 描画ループが参照する「実効 tweaks」。rx は受信した config、それ以外はローカル t。
  const viewRef = useRef(view);
  viewRef.current = view;

  // スマホでのページズーム（背景ピンチ・ダブルタップ）を抑止。1本指スクロールや、アバターの
  // pointer ピンチ（userRef）は温存する。obs/tx/rx いずれのモードでも誤ズームは困るので常時。
  useEffect(() => installMobileHardening(), []);
  // 背景色に合わせて theme-color を追従させる。obs は背景 transparent（無効値）なので更新しない。
  useEffect(() => { if (!obsMode) applyThemeColor(view.bgColor); }, [obsMode, view.bgColor]);

  // 顔向き → target への注入（マウス版の pointermove ハンドラの代わり）。
  // 上下左右で別々の振り幅（方向校正で得た rangeXxxDeg）を rad に直し、感度で割る。
  // 感度が高いほど少ない首振りで端まで届く（= maxXxx が小さくなる）。
  const sens = t.sensitivity;
  const poseOptions = {
    maxYawRight: (t.rangeYawRightDeg * DEG) / sens,
    maxYawLeft: (t.rangeYawLeftDeg * DEG) / sens,
    maxPitchUp: (t.rangePitchUpDeg * DEG) / sens,
    maxPitchDown: (t.rangePitchDownDeg * DEG) / sens,
    biasYaw: t.biasYawDeg * DEG,
    biasPitch: t.biasPitchDeg * DEG,
    invertX: t.invertX,
    invertY: t.invertY,
  };
  // 立ち位置（左右・上下）。invert は pose と同じく source 側(純関数)で適用する。
  const positionOptions = { invertX: t.invertSlide, invertY: t.invertSlideY };
  const { videoRef, poseRef, rollRef, posRef, faceScaleRef, mouthRef, eyesClosedRef, blendshapesRef, status } = useFacePose(target, { enabled: !isRx, poseOptions, positionOptions, preferWorker: t.useWorker, deviceId, facingMode: t.facingMode });

  // カメラ許可後（status.phase==='running'）に videoinput を列挙して選択肢を更新する。
  // 許可前はラベルが空なので必ず起動後に列挙する。rx はカメラ無しなので対象外。
  useEffect(() => {
    if (isRx || status.phase !== 'running') return undefined;
    let cancelled = false;
    navigator.mediaDevices?.enumerateDevices?.()
      .then((devs) => {
        if (cancelled) return;
        setCameras(
          devs
            .filter((d) => d.kind === 'videoinput')
            .map((d) => ({ deviceId: d.deviceId, label: d.label })),
        );
      })
      .catch(() => { /* 列挙失敗は無視（選択肢が空＝自動のまま） */ });
    return () => { cancelled = true; };
  }, [isRx, status.phase]);

  // useFacePose が各 ref に書いた最新値を「signals」へまとめる（avatar-state の入力）。
  function readSignals() {
    return {
      x: target.current.x,
      y: target.current.y,
      yaw: poseRef.current.yaw,
      pitch: poseRef.current.pitch,
      roll: rollRef.current,
      posX: posRef.current.x,
      posY: posRef.current.y,
      faceScale: faceScaleRef.current,
      mouth: mouthRef.current,
      eyesClosed: eyesClosedRef.current,
    };
  }

  // WS 中継。tx は config 要求に応答し CEF 接続を表示、rx は state/config を受信。
  const relayApi = useRelay(mode, {
    relayUrl: relay.relayUrl,
    getConfig: () => tweaksRef.current,
    onState: (arr) => { latestFrameRef.current = decodeStateFrame(arr); },
    onConfig: (cfg) => setRxConfig((prev) => ({ ...prev, ...cfg })),
    onCue: (id) => cueController.run(id), // rx: tx から来た演出をこの端末(OBS)で再生
  });
  // tx の発火を rx へ転送するための送信口。毎レンダー最新の sendCue を ref に差す。
  cueSendRef.current = relayApi.sendCue;

  // tx: 設定が変わったら CEF へ config を送る（数秒ごとの再送はしない＝変更時のみ）。
  useEffect(() => {
    if (mode !== 'tx') return;
    relayApi.sendConfig(t);
    // relayApi.sendConfig は clientRef を見るので、依存は mode と t だけでよい。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, t]);

  // いまの顔向き（生角度）を「正面」として記録する。少し下や横を向いた
  // 自然な姿勢を中立にしたいとき用。
  function calibrateCenter() {
    setTweak('biasYawDeg', Math.round(poseRef.current.yaw / DEG));
    setTweak('biasPitchDeg', Math.round(poseRef.current.pitch / DEG));
  }
  function resetCenter() {
    setTweak('biasYawDeg', 0);
    setTweak('biasPitchDeg', 0);
  }

  // 十字校正ボタンのフィードバック（'ok' | 'err'）を方向ごとに一定時間出す。
  function flashDir(dir, ok) {
    setDirFlash((prev) => ({ ...prev, [dir]: ok ? 'ok' : 'err' }));
    clearTimeout(dirFlashTimersRef.current[dir]);
    dirFlashTimersRef.current[dir] = setTimeout(() => {
      setDirFlash((prev) => {
        const next = { ...prev };
        delete next[dir];
        return next;
      });
    }, CALIBRATE_FEEDBACK_MS);
  }

  // 十字の「正」ボタン: 旧「校正」ボタンと同じ＝今の向き＝正面・距離＝基準・目＝まばたき
  // なし・かしげ＝0 をまとめて取り直す。フィードバックは中央ボタン上に ✓ を出す。
  function calibrateCenterCross() {
    calibrateAll();
    flashDir('center', true);
  }

  // 上下左右の校正: その向きに顔を振り切った姿勢で押す。1回の押下で
  //   ① 振り幅（片側レンジ rangeXxxDeg）が画面端(±1)に来るよう校正、
  //   ② その向きでの「見かけ上のズレ」を打ち消す＝アバターに余計な変化を出さない:
  //      左右 → 位置ズレ(slidePoseCompX)・かしげ混入(tiltYawComp)、
  //      上下 → ズーム変化(zoomPitchComp)・位置ズレ(slidePoseCompY)、
  //      共通 → 目（向いて目が閉じたと誤検出しないよう開眼基準を必要なら引き上げる）。
  //   （距離は左右では不変＝faceScale は高さ基準で yaw に強い。かしげは上下では混入しない。）
  // 顔の向きだけ変えて（平行移動せず・距離を変えず）押す前提。逆向き・振り不足は
  // computeDirectionRange が null を返すので ✗ を出して何も書かない。
  function calibrateDirection(dir) {
    const yaw = poseRef.current.yaw;
    const pitch = poseRef.current.pitch;
    const res = computeDirectionRange({
      yawRad: yaw,
      pitchRad: pitch,
      biasYawDeg: t.biasYawDeg,
      biasPitchDeg: t.biasPitchDeg,
      dir,
      sensitivity: t.sensitivity,
      minDeg: CALIBRATE_MIN_SWING_DEG,
    });
    if (!res) {
      flashDir(dir, false);
      return;
    }
    const edits = { [res.key]: res.deg };
    // 左右: 位置ズレ(slidePoseCompX) と かしげ混入(tiltYawComp) を打ち消す（無効なら据え置き）。
    if (dir === 'left' || dir === 'right') {
      const compX = computeSlidePoseCompX({ posX: posRef.current.x, yaw, invertSlide: t.invertSlide });
      if (compX != null) edits.slidePoseCompX = compX;
      const compTilt = computeTiltYawComp({ roll: rollRef.current, yaw, biasRollRad: t.biasRollDeg * DEG });
      if (compTilt != null) edits.tiltYawComp = compTilt;
    }
    // 上下: ズーム変化(zoomPitchComp) と 位置ズレ(slidePoseCompY) を打ち消す。
    // ズームは実行時パイプラインに合わせ、口開き補正(zoomMouthComp)を先に通したサイズで逆算
    // （既定 zoomMouthComp=0 なら素通し）。基準サイズは手動較正優先・無ければ自動基準。
    if (dir === 'up' || dir === 'down') {
      const baseline = t.zoomBaseline > 0 ? t.zoomBaseline : exprStateRef.current.autoBaseline;
      const szMouth = compensateScaleForMouth(faceScaleRef.current, mouthRef.current, t.zoomMouthComp);
      const compZ = computeZoomPitchComp({ faceScale: szMouth, pitch, baseline });
      if (compZ != null) edits.zoomPitchComp = compZ;
      const compY = computeSlidePoseCompY({ posY: posRef.current.y, pitch, invertSlideY: t.invertSlideY });
      if (compY != null) edits.slidePoseCompY = compY;
    }
    // 目: 向いた姿勢で目が閉じたと誤検出しないよう、開眼基準を今の値まで引き上げる（下げない）。
    // 方向ごとに押すと積み上がるので、まばたき検出が潰れない範囲(0.9)で頭打ちにする。
    const ec = eyesClosedRef.current;
    if (Number.isFinite(ec) && ec > t.eyesOpenBias) {
      edits.eyesOpenBias = Math.min(0.9, Math.round(ec * 100) / 100);
    }
    setTweak(edits);
    flashDir(dir, true);
  }
  // 上下左右の振り幅を既定（≒従来の対称レンジ）へ戻す。1回の setTweak でまとめて反映する。
  function resetRanges() {
    setTweak({
      rangeYawLeftDeg: TWEAK_DEFAULTS.rangeYawLeftDeg,
      rangeYawRightDeg: TWEAK_DEFAULTS.rangeYawRightDeg,
      rangePitchUpDeg: TWEAK_DEFAULTS.rangePitchUpDeg,
      rangePitchDownDeg: TWEAK_DEFAULTS.rangePitchDownDeg,
    });
  }

  // 今の首かしげ(roll)を「正面のかしげ(0)」として記録する。常に少し傾いて
  // 写ってしまう人向け。以降はこの中立からのズレ分だけアバターがかしげる。
  function calibrateTilt() {
    setTweak('biasRollDeg', Math.round(rollRef.current / DEG));
  }
  function resetTilt() {
    setTweak('biasRollDeg', 0);
  }

  // いまの目の状態（開いている想定）を「まばたきなし」の基準にする。
  // 細目やカメラ角度で eyeBlink が開眼時でも高めに出る人向け。現在の値を
  // オフセットとして記録し、以降はこれを差し引いて閉じ具合を判定する。
  function calibrateEyesOpen() {
    setTweak('eyesOpenBias', Math.round(eyesClosedRef.current * 100) / 100);
  }
  function resetEyesOpen() {
    setTweak('eyesOpenBias', 0);
  }

  // いまのカメラとの距離（顔の見かけサイズ）を「等倍(ズーム1)」の基準にする。
  // 以降はこのサイズとの比がズーム率になる（近づくと拡大・離れると縮小）。
  function calibrateZoom() {
    if (faceScaleRef.current > 0) {
      setTweak('zoomBaseline', Math.round(faceScaleRef.current * 1000) / 1000);
    }
  }
  function resetZoom() {
    setTweak('zoomBaseline', 0);
    exprStateRef.current.autoBaseline = 0; // 自動基準も捨てて次の検出で取り直す
  }

  // 今の向き＝正面・今の距離＝等倍の基準・今の目の大きさ＝まばたきなし・かしげ＝0 を
  // まとめて取り直す。個別校正をそのまま順に呼ぶだけ（計算を重複させない）。setTweak は
  // 関数更新でマージするので、続けて呼んでも取りこぼさず同フレームに反映される。
  function calibrateAll() {
    calibrateCenter();   // 今の向きを正面に
    calibrateZoom();     // 今の距離を等倍の基準に
    calibrateEyesOpen(); // 今の目の大きさをまばたきなしに
    calibrateTilt();     // 今のかしげを正面(0)に
  }
  // アンマウント時にフィードバック用タイマーを後始末する（解除後の setState を避ける）。
  useEffect(() => () => {
    Object.values(dirFlashTimersRef.current).forEach(clearTimeout);
  }, []);

  // ユーザー操作（移動・ズーム）2層の現在値を userRef に反映。操作 effect とボタンの共通経路。
  function applyUserTransform() {
    const el = userRef.current;
    if (el) el.style.transform = composeUserTransform(userTransform.current);
  }
  // 移動・ズームを両層とも初期化（位置中央・等倍）。リセットボタン/ダブルクリック用。
  function resetUserTransform() {
    const u = userTransform.current;
    u.shared.x = 0; u.shared.y = 0; u.shared.zoom = 1;
    u.local.x = 0; u.local.y = 0; u.local.zoom = 1;
    applyUserTransform();
  }

  // ユーザーズームの上下限(Tweaks)を変えたら、現在のズーム値を新範囲へ即クランプし直して
  // 表示へ反映する。スライダー操作だけで最小/最大が「今すぐ」効くようにする（次のホイール
  // 操作を待たない）。rx は受信値を commit が当てるので対象外。
  useEffect(() => {
    if (isRx) return;
    const lo = t.userZoomMin ?? USER_ZOOM_MIN;
    const hi = t.userZoomMax ?? USER_ZOOM_MAX;
    const u = userTransform.current;
    u.shared.zoom = clamp(u.shared.zoom, lo, hi);
    u.local.zoom = clamp(u.local.zoom, lo, hi);
    applyUserTransform();
    // applyUserTransform/clamp は安定参照。上下限と rx 切替のみで張り直せばよい。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.userZoomMin, t.userZoomMax, isRx]);

  // メインループ。3モード共通で「状態フレーム → 平滑化 → 描画」を回す。
  //   local/tx: signals から computeStateFrame（口/まばたき/補正を確定）→ applyState。
  //             tx はさらに状態フレームを ~30Hz 上限で送信。
  //   rx:       受信済みの状態フレームを applyState（平滑化＝ジッタ吸収）。カメラ無し。
  useEffect(() => {
    let raf;
    let lastCell = { r: 2, c: 2 };
    let lastSheet = -1;
    let lastSent = 0;
    const SEND_INTERVAL_MS = 33; // 送信レート上限（~30Hz）

    // apply-state の結果を画面へ反映（セル/シートは変化時のみ setState、transform は直書き）。
    function commit(out) {
      if (out.cell.r !== lastCell.r || out.cell.c !== lastCell.c) {
        lastCell = out.cell;
        setCell(lastCell);
      }
      if (out.sheet !== lastSheet) {
        lastSheet = out.sheet;
        setSheet(out.sheet);
      }
      const mEl = motionRef.current;
      if (mEl) mEl.style.transform = out.motionTransform;
      const zEl = zoomRef.current;
      if (zEl) zEl.style.transform = out.zoomTransform;
      // rx（CEF）はユーザー操作も受信値に同調させる。tx/local は userRef をローカル操作が
      // 直接握るので、ここでは触らない（commit が毎フレーム上書きするのを避ける）。
      if (mode === 'rx') {
        const uEl = userRef.current;
        if (uEl) uEl.style.transform = out.userTransform;
      }
    }

    // ジェスチャー再生中は顔追従ポーズを一時上書き: セルを差し替え、回転/拡縮を専用ラッパーへ。
    // 終了(null)で解放→ライブ追従へ戻る。送信フレームには触れない（rx へは cue id を別途転送）。
    function applyGesture(out, now) {
      const g = gesturePlayRef.current;
      if (!g) return out;
      if (g.base == null) g.base = out.cell;
      const s = sampleGesture(GESTURES[g.name], now - g.start, g.base, { rows: ROWS, cols: COLS });
      if (!s) {
        gesturePlayRef.current = null;
        if (gestureFxRef.current) gestureFxRef.current.style.transform = '';
        return out;
      }
      if (gestureFxRef.current) gestureFxRef.current.style.transform = gestureTransform(s);
      return { ...out, cell: s.cell };
    }

    function tick(now) {
      let out = null;
      if (mode === 'rx') {
        const frame = latestFrameRef.current;
        if (frame) out = applyState(frame, viewRef.current, smoothStateRef.current);
      } else {
        const tw = tweaksRef.current;
        // 送信する移動量だけ moveRatio 倍（rx が tx の比率倍動く）。tx 自身の表示は
        // userRef 直書きのまま 1:1 で、ここでは送信値だけ拡縮する。ズームは対象外。
        const sh = userTransform.current.shared;
        const ratio = tw.moveRatio == null ? 1 : tw.moveRatio;
        const sentUser = { x: sh.x * ratio, y: sh.y * ratio, zoom: sh.zoom };
        const frame = computeStateFrame(
          readSignals(), tw, exprStateRef.current, now,
          { blinkOverride: autoBlinkRef.current, user: sentUser },
        );
        if (mode === 'tx' && now - lastSent >= SEND_INTERVAL_MS) {
          lastSent = now;
          relayApi.sendState(encodeStateFrame(frame));
        }
        out = applyState(frame, tw, smoothStateRef.current);
      }
      if (out) commit(applyGesture(out, now));
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // mode が変われば張り直す。relayApi.sendState は clientRef 参照なので依存に含めない。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // アバターをドラッグで移動、ホイール/ピンチでズーム（ユーザー操作分）。
  // 顔追従(motionRef/zoomRef)とは別の最外ラッパー(userRef)へ直書きするので互いに干渉しない。
  // 操作は2層: 通常は shared（CEF へ送り rx も同調）、Shift 併用は local（この端末だけ・送らない）。
  // 表示は両者の合成（移動=加算 vw/vh / ズーム=乗算）。rx 自身は受信値を commit が当てるので無効化。
  // ダブルクリックで両層リセット。
  useEffect(() => {
    if (isRx) return undefined;   // rx は受信した userTransform を commit が反映するので操作は受けない
    const el = userRef.current;
    if (!el) return undefined;
    const u = userTransform.current;   // { shared, local }
    const pointers = new Map();   // pointerId → { x, y }
    let drag = null;              // { px, py, ox, oy, layer } 1本指/マウスの移動（px=生座標, ox/oy=vw/vh）
    let pinch = null;             // { dist, zoom, layer } 2本指の拡縮
    let movedFar = false;         // 押下スケールを解除済みか

    // どの層を操作するか。Shift キー（PC）または「反映先」トグル ON（スマホ）= local（この端末
    // だけ）、いずれも無ければ shared（CEF へ送る）。
    const layerFor = (e) => ((e.shiftKey || localModeRef.current) ? u.local : u.shared);

    // 表示は shared+local の合成。送信されるのは shared だけ（composeUserTransform に式を集約）。
    const apply = () => { el.style.transform = composeUserTransform(u); };
    // pointers が2点あるときの指間距離。pinch 中のみ呼ぶ前提。
    const dist = () => {
      const [a, b] = pointers.values();
      return Math.hypot(a.x - b.x, a.y - b.y);
    };

    const onDown = (e) => {
      el.setPointerCapture?.(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        const layer = layerFor(e);
        drag = { px: e.clientX, py: e.clientY, ox: layer.x, oy: layer.y, layer };
        movedFar = false;
        el.style.cursor = 'grabbing';
      } else if (pointers.size === 2) {
        const layer = drag ? drag.layer : layerFor(e); // 1本目で決めた層を維持
        drag = null;                       // 2本指はピンチ優先
        pinch = { dist: dist() || 1, zoom: layer.zoom, layer };
      }
    };
    const onMove = (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pointers.size >= 2) {
        const tw = tweaksRef.current;        // 上下限は Tweaks から毎回読む（リロード不要で即反映）
        pinch.layer.zoom = clamp(pinch.zoom * (dist() / pinch.dist),
          tw.userZoomMin ?? USER_ZOOM_MIN, tw.userZoomMax ?? USER_ZOOM_MAX);
        apply();
      } else if (drag) {
        // px の移動量を vw/vh へ変換（解像度差を吸収して CEF にも比例反映させる）。
        drag.layer.x = drag.ox + (e.clientX - drag.px) / window.innerWidth * 100;
        drag.layer.y = drag.oy + (e.clientY - drag.py) / window.innerHeight * 100;
        if (!movedFar &&
            Math.hypot(e.clientX - drag.px, e.clientY - drag.py) > DRAG_SQUISH_CANCEL_PX) {
          movedFar = true;
          setPressed(false);               // ドラッグ中は押下スケールを解除
        }
        apply();
      }
    };
    const onUp = (e) => {
      pointers.delete(e.pointerId);
      el.releasePointerCapture?.(e.pointerId);
      // ピンチ→1本指に戻るときに層を引き継ぐため、消す前に layer を控える。
      const prevLayer = (pinch && pinch.layer) || (drag && drag.layer) || u.shared;
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 1) {
        // 残った指で取り直してジャンプを防ぐ（層は維持・squish は不要）。
        const [p] = pointers.values();
        drag = { px: p.x, py: p.y, ox: prevLayer.x, oy: prevLayer.y, layer: prevLayer };
        movedFar = true;
      } else if (pointers.size === 0) {
        drag = null;
        setPressed(false);                 // capture で charRef の up が来ないため明示解除
        el.style.cursor = 'grab';
      }
    };
    const onWheel = (e) => {
      e.preventDefault();
      const tw = tweaksRef.current;        // 感度・上下限は Tweaks から毎回読む（リロード不要で即反映）
      const layer = layerFor(e);           // Shift+ホイール = local（この端末だけ）
      const sens = wheelSensFromDial(tw.wheelZoomDial ?? WHEEL_SENS_DIAL_DEFAULT);
      layer.zoom = clamp(layer.zoom * Math.exp(-e.deltaY * sens),
        tw.userZoomMin ?? USER_ZOOM_MIN, tw.userZoomMax ?? USER_ZOOM_MAX);
      apply();
    };
    // 両層を初期化（位置中央・等倍）。リセットボタンと共通経路。
    const onReset = () => resetUserTransform();

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('dblclick', onReset);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('dblclick', onReset);
    };
    // setPressed は安定参照。userRef はマウント後固定なので初回のみ張ればよい。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 自動まばたき（まばたき同調OFFのときだけ動作。ONのときは computeStateFrame が実眼に追従）。
  // 結果は autoBlinkRef に書き、メインループが blinkOverride として computeStateFrame に渡す。
  // rx は sheet を受信するので自動まばたきは動かさない。
  useEffect(() => {
    if (isRx || t.blinkSync) return undefined;
    let alive = true;
    let timer;
    const rand = (a, b) => a + Math.random() * (b - a);
    function blinkOnce(dur, after) {
      autoBlinkRef.current = true;
      timer = setTimeout(() => {
        if (!alive) return;
        autoBlinkRef.current = false;
        timer = setTimeout(after, rand(120, 220));
      }, dur);
    }
    function doBlink() {
      if (!alive) return;
      const roll = Math.random();
      if (roll < 0.22) {
        blinkOnce(rand(80, 120), () => { if (alive) blinkOnce(rand(70, 110), schedule); });
      } else if (roll < 0.28) {
        blinkOnce(rand(260, 420), schedule);
      } else {
        blinkOnce(rand(90, 150), schedule);
      }
    }
    function schedule() {
      if (!alive) return;
      const u = Math.random();
      let wait;
      if (u < 0.12) wait = rand(700, 1500);
      else if (u < 0.82) wait = rand(1800, 4500);
      else wait = rand(4500, 9000);
      timer = setTimeout(doBlink, wait);
    }
    schedule();
    return () => { alive = false; clearTimeout(timer); };
  }, [t.blinkSync, isRx]);

  // 表情係数パネルの更新（表示ONのときだけ ~10fps で ref → state にコピー）。
  // OFF時はインターバルを張らないので毎フレーム再描画のコストはゼロ。
  useEffect(() => {
    if (!t.showExpr) return undefined;
    const id = setInterval(() => {
      const cats = blendshapesRef.current || [];
      const scoreByName = new Map(cats.map((c) => [c.categoryName, c.score]));
      setExprValues(MAIN_BLENDSHAPES.map(({ key, label }) => ({
        label, value: scoreByName.get(key) || 0,
      })));
    }, 100);
    return () => clearInterval(id);
  }, [t.showExpr, blendshapesRef]);

  // ステージモード中だけ T キーで Tweaks パネルを開閉できる（OBS の「対話」で較正する用）。
  // 通常モードでは常時パネルがあるのでフックを張らない。
  useEffect(() => {
    if (!obsMode) return undefined;
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return; // 入力中は無視
      if (e.key === 't' || e.key === 'T') setPanelOpen((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [obsMode]);

  // 演出: 全体音量を反映。
  useEffect(() => { cueBoard.setMasterGain(view.sbGain); }, [cueBoard, view.sbGain]);
  // sound にパス/URL があるキューを先読み（無ければ tone で鳴るので 0 アセットでも可）。
  useEffect(() => {
    cueController.cues.forEach((c) => { if (c.sound) cueBoard.loadUrl(c.id, c.sound); });
  }, [cueBoard, cueController]);
  // 数字キーでキュー発火（入力中・修飾キー併用は無視）。obsMode でも有効。
  useEffect(() => {
    const onCueKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      cueController.runByKey(e.key);
    };
    window.addEventListener('keydown', onCueKey);
    return () => window.removeEventListener('keydown', onCueKey);
  }, [cueController]);
  // ?cue=hello,clap で読み込み時に自動発火（OBS の CEF は自動再生が許可されている）。
  useEffect(() => {
    const { cues } = parseCueParam(typeof window !== 'undefined' ? window.location.search : '');
    if (!cues.length) return;
    cueBoard.resume();
    cues.forEach((id) => cueController.run(id));
  }, [cueBoard, cueController]);

  // 特定の音（例: こんにちは.mp3）をキューに割り当てる。その場限り（再読込で消える）。
  async function assignCueFile(id, file) {
    const ok = await cueBoard.assignFile(id, file);
    if (ok) setCueAssigned((s) => new Set(s).add(id));
  }

  const frames = useMemo(() => {
    const arr = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) arr.push({ r, c });
    return arr;
  }, []);

  // エフェクト設定（view 由来）→ SpriteAvatar へ。値が変わったときだけ新オブジェクトを作り
  // 参照を安定させる（毎レンダーで setEffect が走るのを防ぐ）。
  const effects = useMemo(() => ({
    // cueFx 中はグローを一時的に上書き（発火フラッシュ）。通常時は view の設定を使う。
    glow: cueFx && cueFx.glow
      ? { enabled: true, strength: cueFx.glow, color: cueFx.glowColor || view.effGlowColor }
      : { enabled: view.effGlow, strength: view.effGlowStrength, color: view.effGlowColor },
    dissolve: { enabled: view.effDissolve, amount: view.effDissolveAmount, color: view.effDissolveColor },
  }), [
    view.effGlow, view.effGlowStrength, view.effGlowColor,
    view.effDissolve, view.effDissolveAmount, view.effDissolveColor,
    cueFx,
  ]);

  const dark = view.bgColor === '#2B2926';
  const inkColor = dark ? 'rgba(255,248,238,0.85)' : 'rgba(60,48,38,0.8)';
  const subColor = dark ? 'rgba(255,248,238,0.45)' : 'rgba(60,48,38,0.45)';

  // 右下 Tweaks ボタンの幅ぶんを空け、中央タイトル帯は少し上へ逃がすのに使う。
  const isNarrow = useIsNarrow();

  // rx はカメラを持たないので、状態表示は中継リンクの接続有無にする。
  const statusText = isRx
    ? (relayApi.linkUp ? '中継に接続中（受信）' : '中継に未接続')
    : ({
        idle: 'カメラ停止中',
        loading: 'カメラ起動中…',
        error: `エラー: ${status.error || ''}`,
      }[status.phase] || (status.faceDetected ? '顔を検出中' : '顔が見つかりません'));
  const statusColor = isRx
    ? (relayApi.linkUp ? '#46C26A' : '#E5A23D')
    : (status.phase === 'error' ? '#E5484D'
      : status.phase === 'running' && status.faceDetected ? '#46C26A'
      : '#E5A23D');

  // 実際の推論先（worker を希望しても dev・非対応・フォールバック時は main）。
  const engineLabel = status.engine === 'worker' ? 'Web Worker'
    : status.engine === 'main' ? 'メインスレッド' : '—';
  const engineNote = t.useWorker && status.engine === 'main' ? '（フォールバック）' : '';
  const onWorker = status.engine === 'worker';

  return (
    <div
      ref={stageRef}
      style={{
        position: 'fixed', inset: 0, background: obsMode ? 'transparent' : view.bgColor,
        overflow: 'hidden', transition: 'background 0.4s ease',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column',
        fontFamily: "'Zen Maru Gothic', sans-serif"
      }}
    >
      {/* 顔向き推定の入力。プレビューOFFでも検出のため要素自体は残し、画面外に逃がす。
          プレビュー時は DraggablePanel で掴んで移動でき、✕で隠せる（= preview を OFF）。
          disabled の間も <video> は同一要素のままなのでカメラ映像は貼り直されない。 */}
      <DraggablePanel
        id="preview"
        title="カメラ"
        disabled={!showPreview}
        onClose={() => setTweak('preview', false)}
        closeLabel="カメラ映像を隠す"
        defaultStyle={{ top: 16, left: 16 }}
        defaultWidth="min(160px, 34vw)"
        style={showPreview ? {
          zIndex: 5, borderRadius: 10, overflow: 'hidden', background: '#000', color: '#fff',
          padding: '4px 5px 5px', boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
        } : {
          position: 'absolute', width: 1, height: 1, opacity: 0,
          pointerEvents: 'none', overflow: 'hidden',
        }}
      >
        <video
          ref={videoRef}
          playsInline
          muted
          style={showPreview ? {
            display: 'block', width: '100%', height: 'auto', borderRadius: 6,
            transform: 'scaleX(-1)', // 鏡像（自撮り表示）
          } : {
            width: '100%', height: '100%',
          }}
        ></video>
      </DraggablePanel>

      {/* zoomRef: カメラ距離→ズーム(scale)を中央基準で当てる外側ラッパー。
          motionRef: 首かしげ(rotate)・左右上下スライド(translate)を当てる内側ラッパー。
          内側の charRef は既存の bob アニメ＋押下スケールを保持し、関心を分離する。
          かしげは「首元」を支点にする → 回転原点を下部中央(横50%・縦 tiltPivotY%)に置く。
          translate は transform-origin の影響を受けないのでスライドは不変。
          ズームは別ラッパー(原点=中央)に分けることで、かしげの支点と干渉させない。 */}
      {/* userRef: ドラッグ移動・ホイール/ピンチズーム（ユーザー操作）を当てる最外ラッパー。
          顔追従の zoomRef/motionRef より外側なので、画面座標での平行移動＋全体スケールになる。 */}
      <div
        ref={userRef}
        style={{ position: 'relative', zIndex: 1, willChange: 'transform', touchAction: 'none', cursor: isRx ? 'default' : 'grab' }}
      >
      <div ref={zoomRef} style={{ willChange: 'transform' }}>
       <div ref={motionRef} style={{ willChange: 'transform', transformOrigin: `50% ${view.tiltPivotY}%` }}>
        {/* ジェスチャー(回転/拡縮)用ラッパー。中心原点なので spin が中心で回る。顔追従(首元原点の tilt)とは別レイヤー。 */}
        <div ref={gestureFxRef} style={{ willChange: 'transform' }}>
        <div
          ref={charRef}
          onPointerDown={() => setPressed(true)}
          onPointerUp={() => setPressed(false)}
          onPointerLeave={() => setPressed(false)}
          className="bob"
          style={{
            position: 'relative',
            width: `${view.charSize * 4 / 3}vmin`, height: `${view.charSize * 4 / 3}vmin`,
            maxWidth: 1200, maxHeight: 1200,
            transform: pressed ? 'scale(0.94)' : 'scale(1)',
            transition: 'transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1)',
            // tweak `shadow` (0~6)。大きいほど濃い影で透過背景上の輪郭を立たせる（0 は無し）。
            // view = rx は同期値・それ以外はローカル値。範囲外/未設定は 0(なし) にクランプ。
            filter: SHADOW_FILTERS[clamp(Math.round(view.shadow ?? 0), 0, SHADOW_MAX)],
            userSelect: 'none', touchAction: 'none'
          }}
        >
          {/* PixiJS スプライト描画。150枚の img スタックを1枚の canvas に置き換える。
              顔推定が決めた sheet(0..5)/cell をそのまま渡し、コアが該当セルを描く。
              key にアバターIDを使い、切替時は Pixi を dispose→再生成する（sheets は初期化時固定）。 */}
          <SpriteAvatar
            key={avatarId}
            sheets={sheetUrls}
            rows={avatar.rows}
            cols={avatar.cols}
            sheetIndex={sheet}
            cell={cell}
            effects={effects}
          ></SpriteAvatar>
        </div>
        </div>
       </div>
      </div>
      </div>

      {/* リアクション・スタンプ。アバター本体(charRef)の実位置・サイズに毎フレーム追従
          （顔追従/ドラッグ/ズームに連動）。place で 頭の上/頭にオーバーレイ を切替。obs でも表示。 */}
      <CueStampLayer ref={cueStampRef} anchorRef={charRef}></CueStampLayer>

      {/* 演出ボタン列（操作用・右端中央）。配信(obsMode)/受信(rx)では非表示。Tweaks で表示トグル可。 */}
      {!obsMode && !isRx && t.sbButtons ? (
        <div style={{
          position: 'absolute', right: 'calc(14px + var(--sar))', top: '50%',
          transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', gap: isNarrow ? 6 : 8, zIndex: 6
        }}>
          {cueController.cues.map((c) => (
            <button key={c.id} onClick={() => cueController.run(c.id)} title={`${c.label}（キー: ${c.key || '-'}）`}
              style={{
                position: 'relative', width: isNarrow ? 40 : 50, height: isNarrow ? 38 : 46, fontSize: isNarrow ? 18 : 21, lineHeight: 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: dark ? 'rgba(48,45,42,0.92)' : 'rgba(255,255,255,0.9)',
                border: `1.5px solid ${dark ? 'rgba(255,248,238,0.18)' : 'rgba(60,48,38,0.14)'}`,
                borderRadius: 11, cursor: 'pointer', overflow: 'hidden', whiteSpace: 'nowrap',
                boxShadow: '0 4px 14px rgba(60,48,38,0.08)'
              }}>
              {c.icon || c.stamp || c.label}
              {c.key ? (
                <span style={{ position: 'absolute', right: 3, bottom: 2, fontSize: 9, fontWeight: 700, color: subColor }}>{c.key}</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      {!obsMode && (
      <div style={{
        position: 'absolute',
        top: 'calc(8px + var(--sat))',
        left: 'calc(12px + var(--sal))', right: 'auto',
        textAlign: 'left', pointerEvents: 'none', whiteSpace: 'nowrap'
      }}>
        <div style={{ fontSize: 'clamp(18px, 2.4vmin, 28px)', fontWeight: 700, color: inkColor, letterSpacing: '0.06em' }}>ぐるぐるアバター カメラ版</div>
        <div style={{ fontSize: 'clamp(13px, 1.7vmin, 16px)', color: subColor, marginTop: 6, letterSpacing: '0.08em', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: statusColor, display: 'inline-block' }}></span>
          {statusText}
        </div>
        {/* 実際にどのエンジンで推論しているか（Worker / メインスレッド）を常時表示。rx は推論なし。 */}
        {!isRx && (
        <div style={{ marginTop: 4 }}>
          <span style={{ fontSize: 'clamp(12px, 1.5vmin, 14px)', color: subColor, letterSpacing: '0.06em', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: onWorker ? '#46C26A' : 'rgba(120,120,120,0.55)', display: 'inline-block' }}></span>
            推論: {engineLabel}{engineNote}
          </span>
        </div>
        )}
        {/* tx（iPhone）: 中継リンクと CEF（受信側）の接続状況を表示する。 */}
        {mode === 'tx' && (
        <div style={{ marginTop: 4 }}>
          <span style={{ fontSize: 'clamp(12px, 1.5vmin, 14px)', color: subColor, letterSpacing: '0.06em', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: relayApi.peer.connected ? '#46C26A' : 'rgba(120,120,120,0.55)', display: 'inline-block' }}></span>
            {relayApi.linkUp
              ? (relayApi.peer.connected ? `CEF 接続中（${relayApi.peer.count}）` : 'CEF 未接続')
              : '中継に未接続'}
          </span>
        </div>
        )}
      </div>
      )}

      {!obsMode && (
      <a href="talk.html" style={{
        position: 'absolute', top: 'calc(18px + var(--sat))', right: 'calc(18px + var(--sar))',
        fontSize: 14, fontWeight: 700,
        color: subColor, textDecoration: 'none', letterSpacing: '0.06em'
      }}>口パク版 →</a>
      )}

      {!obsMode && (
      <a href="tracking.html" style={{
        position: 'absolute', top: 'calc(40px + var(--sat))', right: 'calc(18px + var(--sar))',
        fontSize: 14, fontWeight: 700,
        color: subColor, textDecoration: 'none', letterSpacing: '0.06em'
      }}>手・ポーズ →</a>
      )}

      {/* iPhone(tx) を開くための QR。tailscale の長い URL を手入力せず読み取れる。
          公開オリジンは vite.fork.js が __TX_PUBLIC_ORIGIN__ に注入（無ければ現在のオリジン）。
          配信(obsMode)には出さない。 */}
      {!obsMode && (
        <TxQrButton url={TX_URL} subColor={subColor} inkColor={inkColor}
          style={{ top: 'calc(62px + var(--sat))', right: 'calc(18px + var(--sar))' }} />
      )}

      {/* GitHub リポジトリへのリンク（外部・別タブ）。配信には映さない。 */}
      {!obsMode && (
      <a href="https://github.com/tommie-jp/guruguru-avatar" target="_blank" rel="noopener noreferrer" style={{
        position: 'absolute', top: 'calc(84px + var(--sat))', right: 'calc(18px + var(--sar))',
        fontSize: 14, fontWeight: 700,
        color: subColor, textDecoration: 'none', letterSpacing: '0.06em'
      }}>GitHub ↗</a>
      )}

      {/* WS 中継の役割切替リンク。相対パスなので開いているホスト（localhost / Tailscale 等）を
          そのまま引き継ぐ。現在のモードを太字＋色で強調する。配信には映さない。 */}
      {!obsMode && (
      <a href="index.html?tx" style={{
        position: 'absolute', top: 'calc(106px + var(--sat))', right: 'calc(18px + var(--sar))',
        fontSize: 14,
        fontWeight: mode === 'tx' ? 900 : 700,
        color: mode === 'tx' ? inkColor : subColor,
        textDecoration: 'none', letterSpacing: '0.06em'
      }}>OBS送信側tx →</a>
      )}

      {!obsMode && (
      // rx は既定で透過＋UI 非表示なので、ブラウザのタブで確認できるよう ?obs=0 を付ける。
      <a href="index.html?rx&obs=0" style={{
        position: 'absolute', top: 'calc(128px + var(--sat))', right: 'calc(18px + var(--sar))',
        fontSize: 14,
        fontWeight: mode === 'rx' ? 900 : 700,
        color: mode === 'rx' ? inkColor : subColor,
        textDecoration: 'none', letterSpacing: '0.06em'
      }}>OBS受信側rx →</a>
      )}

      {/* 下部コントロール（左下）: 各 HUD のワンタップ表示トグル＋「反映先(OBS/ローカル)」を
          1行にまとめ、文字/ボタンサイズを統一して折り返す。リセットは Tweaks に集約済み。
          配信(obs)・rx では非表示。 */}
      {!obsMode && !isRx && (
      <PanelToggles
        inkColor={inkColor}
        subColor={subColor}
        style={{
          bottom: isNarrow ? 'calc(14px + var(--sab))' : 'calc(16px + var(--sab))',
          left: isNarrow ? 'calc(12px + var(--sal))' : 'calc(16px + var(--sal))',
          maxWidth: 'calc(100vw - 120px)',
        }}
        items={[
          { key: 'preview', label: 'カメラ', on: t.preview, toggle: () => setTweak('preview', !t.preview) },
          { key: 'debug', label: 'デバッグ', on: t.showDebug, toggle: () => setTweak('showDebug', !t.showDebug) },
          { key: 'expr', label: '表情', on: t.showExpr, toggle: () => setTweak('showExpr', !t.showExpr) },
          { key: 'calib', label: '向き校正', on: t.showCalib, toggle: () => setTweak('showCalib', !t.showCalib) },
        ]}
      >
        <button
          type="button"
          onClick={() => setLocalMode((v) => !v)}
          title="ドラッグ移動・ズームの反映先（OBS=rxへ送る / ローカル=この端末だけ。PC は Shift 併用でも『ローカル』）"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, lineHeight: 1,
            padding: '4px 10px', borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap',
            border: `1.5px solid ${localMode ? '#E8923C' : '#46C26A'}`,
            background: localMode ? 'rgba(232,146,60,0.14)' : 'rgba(70,194,106,0.12)',
            color: inkColor, fontSize: 13, fontWeight: 700, letterSpacing: '0.03em',
          }}
        >
          <span style={{
            width: 9, height: 9, borderRadius: '50%', display: 'inline-block',
            background: localMode ? '#E8923C' : '#46C26A',
          }}></span>
          {localMode ? 'ローカル' : 'OBS'}
        </button>
      </PanelToggles>
      )}

      {/* バージョン表記（右下に控えめに）。配信に映らないよう obsMode では非表示。
          右下 Tweaks ボタンの真上に逃がして重ならないようにする。狭い画面では
          日付を落とした短縮版にして左下コントロールにも被らない長さにする。 */}
      {!obsMode && (
      <div style={{
        position: 'absolute', bottom: 'calc(54px + var(--sab))',
        right: isNarrow ? 'calc(12px + var(--sar))' : 'calc(16px + var(--sar))', fontSize: 12,
        color: inkColor, letterSpacing: '0.04em', whiteSpace: 'nowrap',
        textAlign: 'right', fontVariantNumeric: 'tabular-nums',
        pointerEvents: 'none', userSelect: 'none'
      }}>{isNarrow ? VERSION_LABEL_SHORT : VERSION_LABEL}</div>
      )}

      {/* （旧「校正」ボタンは廃止。同機能は向き校正パネルの十字「正」ボタンに統合した。） */}

      {/* カメラ起動エラーの詳細。原因切り分け用に obsMode でも常に表示する
          （OBS ブラウザソース内で ?obs=1 のまま読めるように）。 */}
      {status.phase === 'error' ? (
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          maxWidth: 'min(92vw, 560px)', maxHeight: '80vh', overflow: 'auto',
          background: 'rgba(20,16,14,0.92)', color: '#fff', borderRadius: 12,
          padding: '14px 16px', fontFamily: 'ui-monospace, monospace', fontSize: 13,
          lineHeight: 1.65, zIndex: 20, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          border: '1px solid rgba(229,72,77,0.6)', boxShadow: '0 8px 28px rgba(0,0,0,0.4)'
        }}>
          <div style={{ fontWeight: 700, color: '#E5484D', marginBottom: 8, letterSpacing: '0.04em' }}>カメラエラー詳細</div>
          {/* 解決策（OBS の起動方法）を最初に表示する。OBS のブラウザソースは
              --enable-media-stream 付きで起動しないとカメラを使えない
              （詳細は docs-camera/04-OBSでライブ配信.md）。 */}
          <div style={{
            padding: '10px 12px', borderRadius: 8,
            background: 'rgba(229,162,61,0.14)', border: '1px solid rgba(229,162,61,0.5)',
            color: '#FFE0B0'
          }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>OBS で使うには</div>
            <div>OBS を <span style={{ color: '#FFD27A' }}>--enable-media-stream</span> 付きで起動：</div>
            <div style={{ marginTop: 2 }}>obs64.exe --enable-media-stream</div>
            <div style={{ marginTop: 4, opacity: 0.85 }}>
              ショートカットの「リンク先」末尾にフラグを追加（作業フォルダーは変更しない）。
            </div>
          </div>
          {/* 原因切り分け用の診断詳細はその下に表示する。 */}
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.12)' }}>
            {(status.errorDetail && status.errorDetail.length ? status.errorDetail : [status.error || 'unknown']).map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        </div>
      ) : null}

      {/* 主な表情係数（MediaPipe blendshapes）パネル。Tweaks のトグルで表示切替。
          DraggablePanel で掴んで移動でき、✕で隠せる（= showExpr を OFF）。 */}
      {!obsMode && t.showExpr ? (
        <DraggablePanel
          id="expr"
          title="表情係数"
          onClose={() => setTweak('showExpr', false)}
          closeLabel="表情係数パネルを隠す"
          defaultStyle={{ top: 68, right: 12 }}
          defaultWidth="min(200px, 50vw)"
          style={{
            background: 'rgba(0,0,0,0.6)', color: '#fff', borderRadius: 10,
            padding: '7px 9px', fontSize: 11, fontFamily: 'ui-monospace, monospace',
            zIndex: 6, lineHeight: 1.35,
            maxHeight: 'calc(100vh - 84px)', overflow: 'auto',
          }}
        >
          {exprValues.length === 0 ? (
            <div style={{ opacity: 0.6 }}>顔を検出すると表示</div>
          ) : exprValues.map(({ label, value }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
              <span style={{ width: '5.5em', flexShrink: 0, opacity: 0.85, whiteSpace: 'nowrap' }}>{label}</span>
              <span style={{ position: 'relative', flex: 1, height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.18)' }}>
                <span style={{
                  position: 'absolute', left: 0, top: 0, bottom: 0,
                  width: `${Math.round(clamp(value, 0, 1) * 100)}%`, borderRadius: 3,
                  background: value >= 0.5 ? '#E5A23D' : '#46C26A'
                }}></span>
              </span>
              <span style={{ width: '2.4em', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{value.toFixed(2)}</span>
            </div>
          ))}
        </DraggablePanel>
      ) : null}

      {/* デバッグHUD（向き/口/まばたき/姿勢などの生値とグリッド）。Tweaks で表示切替。
          DraggablePanel で掴んで移動でき、✕で隠せる（= showDebug を OFF）。 */}
      {!obsMode && t.showDebug ? (
        <DraggablePanel
          id="debug"
          title="デバッグ"
          onClose={() => setTweak('showDebug', false)}
          closeLabel="デバッグ表示を隠す"
          defaultStyle={{ top: 16, left: showPreview ? 'calc(min(160px, 34vw) + 30px)' : 16 }}
          defaultWidth="210px"
          style={{
            background: 'rgba(0,0,0,0.6)', color: '#fff', borderRadius: 10,
            padding: '7px 9px', fontSize: 12, fontFamily: 'ui-monospace, monospace',
            lineHeight: 1.45, whiteSpace: 'nowrap',
            fontVariantNumeric: 'tabular-nums', // 桁が変わっても幅が動かないよう等幅数字
          }}
        >
          <div>row {cell.r} / col {cell.c}</div>
          <div>x {target.current.x.toFixed(2)} / y {target.current.y.toFixed(2)}</div>
          <div>mouth {['とじ', 'はんびらき', 'ぜんかい'][sheet % 3]}</div>
          <div>blink {sheet >= 3 ? '閉' : '開'} {t.blinkSync ? '(同調)' : '(自動)'}</div>
          <div>roll {(rollRef.current / DEG).toFixed(1)}° / slide {posRef.current.x.toFixed(2)},{posRef.current.y.toFixed(2)}</div>
          <div>size {faceScaleRef.current.toFixed(3)} / zoom {smoothStateRef.current.zoom.toFixed(2)}x</div>
          <div>engine {status.engine || '—'}{engineNote}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 14px)', gap: 3, marginTop: 6 }}>
            {frames.map(({ r, c }) => (
              <div key={`d${r}-${c}`} style={{
                width: 14, height: 14, borderRadius: 3,
                background: r === cell.r && c === cell.c ? '#FFB13D' : 'rgba(255,255,255,0.22)'
              }}></div>
            ))}
          </div>
        </DraggablePanel>
      ) : null}

      {/* 向き校正パネル（独立した浮動パネル。デバッグHUDと同じく Tweaks のトグルで表示切替）。
          掴んで移動でき、✕で隠せる（= showCalib を OFF）。カメラ前提なので rx/obs では出さない。
          コントロールは [data-no-drag] でドラッグ開始を抑止し、タイトル帯だけで掴む。 */}
      {!obsMode && !isRx && t.showCalib ? (
        <DraggablePanel
          id="calib"
          title="向き校正"
          onClose={() => setTweak('showCalib', false)}
          closeLabel="向き校正パネルを隠す"
          defaultStyle={{ top: 68, left: showPreview ? 'calc(min(160px, 34vw) + 30px)' : 16 }}
          defaultWidth="min(260px, 84vw)"
          style={{
            zIndex: 6,
            background: 'rgba(252,250,247,0.97)', color: '#3c3026', borderRadius: 12,
            padding: '8px 10px 10px', boxShadow: '0 8px 28px rgba(0,0,0,0.22)',
            fontFamily: "'Zen Maru Gothic', sans-serif",
          }}
        >
          <div data-no-drag style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 12, lineHeight: 1.5, color: '#6a5a48' }}>
              「正」でまとめて校正（向き・距離・目・かしげ）→ 各方向へ顔を振り切って 上/左/右/下 を押す。
              体は動かさず顔の向きだけ変えて押すと、その向きでの 位置ズレ・かしげ・ズーム・目 も
              同時に補正します。デバッグの「グリッド表示」で到達点を見ながら調整できます。
            </div>
            <DirectionCross flash={dirFlash} onDir={calibrateDirection} onCenter={calibrateCenterCross} />
            <TweakSlider label="左右バイアス" value={t.biasYawDeg} min={-45} max={45} step={1} unit="°"
              onChange={(v) => setTweak('biasYawDeg', v)}></TweakSlider>
            <TweakSlider label="上下バイアス" value={t.biasPitchDeg} min={-45} max={45} step={1} unit="°"
              onChange={(v) => setTweak('biasPitchDeg', v)}></TweakSlider>
            <TweakButton label="上下左右の範囲をリセット" secondary onClick={resetRanges}></TweakButton>
            <TweakButton label="正面をリセット" secondary onClick={resetCenter}></TweakButton>
          </div>
        </DraggablePanel>
      ) : null}

      {!isRx && (!obsMode || panelOpen) && (
      <TweaksPanel closeOnOutsideClick={false}>
        {/* fork:sections — よく触る3つを上に集約し初期展開。残りは折りたたみ
            （開閉は localStorage に永続化）。各セクションはコントロールを内側に
            入れ子にする（兄弟並びは折りたたみ対象にならない）。 */}
        <TweakSection label="顔追従" collapsible defaultOpen>
          <TweakSlider label="感度" value={t.sensitivity} min={0.4} max={2.5} step={0.1}
            onChange={(v) => setTweak('sensitivity', v)}></TweakSlider>
          <TweakSlider label="追従速度" value={t.smoothing} min={0.04} max={0.5} step={0.01}
            onChange={(v) => setTweak('smoothing', v)}></TweakSlider>
          <TweakToggle label="まばたき同調" value={t.blinkSync}
            onChange={(v) => setTweak('blinkSync', v)}></TweakToggle>
          <TweakSlider label="まばたき感度" value={t.blinkSensitivity} min={0.5} max={2.5} step={0.1}
            onChange={(v) => setTweak('blinkSensitivity', v)}></TweakSlider>
          <TweakButton label="今の目の大きさを まばたきなし にする" onClick={calibrateEyesOpen}></TweakButton>
          <TweakButton label="まばたき基準をリセット" secondary onClick={resetEyesOpen}></TweakButton>
        </TweakSection>
        <TweakSection label="口パク" collapsible defaultOpen>
          <TweakSlider label="口の感度" value={t.mouthGain} min={0.3} max={4} step={0.1}
            onChange={(v) => setTweak('mouthGain', v)}></TweakSlider>
          <TweakSlider label="しきい値（はんびらき）" value={t.thHalf} min={0.02} max={0.5} step={0.01}
            onChange={(v) => setTweak('thHalf', v)}></TweakSlider>
          <TweakSlider label="しきい値（ぜんかい）" value={t.thFull} min={0.05} max={0.8} step={0.01}
            onChange={(v) => setTweak('thFull', v)}></TweakSlider>
          <TweakSlider label="口を閉じる速さ" value={t.release} min={0.05} max={0.5} step={0.01}
            onChange={(v) => setTweak('release', v)}></TweakSlider>
        </TweakSection>
        <TweakSection label="見た目" collapsible defaultOpen>
          <TweakSlider label="キャラサイズ" value={t.charSize} min={30} max={92} unit="vmin"
            onChange={(v) => setTweak('charSize', v)}></TweakSlider>
          <TweakColor label="背景色" value={t.bgColor} options={BG_OPTIONS}
            onChange={(v) => setTweak('bgColor', v)}></TweakColor>
          <TweakSlider label="影の濃さ" value={t.shadow} min={0} max={SHADOW_MAX} step={1}
            onChange={(v) => setTweak('shadow', v)}></TweakSlider>
        </TweakSection>
        <TweakSection label="エフェクト" collapsible>
          <TweakToggle label="発光（グロー）" value={t.effGlow}
            onChange={(v) => setTweak('effGlow', v)}></TweakToggle>
          <TweakSlider label="発光の強さ" value={t.effGlowStrength} min={0} max={8} step={0.1}
            onChange={(v) => setTweak('effGlowStrength', v)}></TweakSlider>
          <TweakColor label="発光色" value={t.effGlowColor} options={GLOW_COLORS}
            onChange={(v) => setTweak('effGlowColor', v)}></TweakColor>
          <TweakToggle label="ディゾルブ" value={t.effDissolve}
            onChange={(v) => setTweak('effDissolve', v)}></TweakToggle>
          <TweakSlider label="ディゾルブ量" value={t.effDissolveAmount} min={0} max={1} step={0.01}
            onChange={(v) => setTweak('effDissolveAmount', v)}></TweakSlider>
          <TweakColor label="ディゾルブ縁色" value={t.effDissolveColor} options={DISSOLVE_COLORS}
            onChange={(v) => setTweak('effDissolveColor', v)}></TweakColor>
        </TweakSection>
        <TweakSection label="演出（サウンドボード）" collapsible>
          <TweakSlider label="演出の音量" value={t.sbGain} min={0} max={2} step={0.05}
            onChange={(v) => setTweak('sbGain', v)}></TweakSlider>
          <TweakToggle label="ボタンを表示" value={t.sbButtons}
            onChange={(v) => setTweak('sbButtons', v)}></TweakToggle>
          {cueController.cues.map((c) => (
            <label key={c.id} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: 8, fontSize: 12, padding: '4px 0', cursor: 'pointer'
            }}>
              <span>{c.icon || c.stamp} {c.label} {c.key ? `(${c.key})` : ''} {cueAssigned.has(c.id) ? '🔊' : ''}</span>
              <span style={{ opacity: 0.55 }}>音を割当…</span>
              <input type="file" accept="audio/*" style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) assignCueFile(c.id, f); }} />
            </label>
          ))}
        </TweakSection>
        <TweakSection label="アバター" collapsible>
          {avatarParam ? (
            <TweakRow label="キャラ" value="URL固定">
              <span style={{ fontSize: 14, opacity: 0.8 }}>{avatar.displayName}</span>
            </TweakRow>
          ) : (
            <TweakSelect label="キャラ" value={avatar.id}
              options={avatars.map((a) => ({ value: a.id, label: a.displayName }))}
              onChange={(v) => setTweak('avatarId', v)}></TweakSelect>
          )}
          <TweakRow label="クレジット">
            <span style={{ fontSize: 13, opacity: 0.7, lineHeight: 1.4 }}>{avatar.credit}</span>
          </TweakRow>
        </TweakSection>
        <TweakSection label="カメラ" collapsible>
          {cameraParam ? (
            <TweakRow label="カメラ" value="URL固定">
              <span style={{ fontSize: 14, opacity: 0.8 }}>{cameraLabelEff}</span>
            </TweakRow>
          ) : (
            <TweakSelect label="カメラ" value={cameraSelectValue}
              options={cameraOptions}
              onChange={(v) => setTweak('cameraLabel', v)}></TweakSelect>
          )}
          {!cameraParam && t.cameraLabel === '' && isMobile ? (
            <TweakToggle label="背面カメラ" value={t.facingMode === 'environment'}
              onChange={(v) => setTweak('facingMode', v ? 'environment' : 'user')}></TweakToggle>
          ) : null}
        </TweakSection>
        <TweakSection label="向き校正" collapsible>
          <TweakToggle label="向き校正パネルを表示" value={t.showCalib}
            onChange={(v) => setTweak('showCalib', v)}></TweakToggle>
        </TweakSection>
        <TweakSection label="反転" collapsible>
          <TweakToggle label="左右反転" value={t.invertX}
            onChange={(v) => setTweak('invertX', v)}></TweakToggle>
          <TweakToggle label="上下反転" value={t.invertY}
            onChange={(v) => setTweak('invertY', v)}></TweakToggle>
          <TweakToggle label="カメラ映像を表示" value={t.preview}
            onChange={(v) => setTweak('preview', v)}></TweakToggle>
        </TweakSection>
        <TweakSection label="首かしげ" collapsible>
          <TweakToggle label="首かしげ" value={t.tiltEnabled}
            onChange={(v) => setTweak('tiltEnabled', v)}></TweakToggle>
          <TweakSlider label="かしげ量" value={t.tiltGain} min={0} max={2.5} step={0.1}
            onChange={(v) => setTweak('tiltGain', v)}></TweakSlider>
          <TweakSlider label="かしげ上限" value={t.tiltMax} min={0} max={45} step={1} unit="°"
            onChange={(v) => setTweak('tiltMax', v)}></TweakSlider>
          <TweakSlider label="かしげ支点（高さ）" value={t.tiltPivotY} min={40} max={100} step={1} unit="%"
            onChange={(v) => setTweak('tiltPivotY', v)}></TweakSlider>
          <TweakToggle label="かしげ反転" value={t.invertTilt}
            onChange={(v) => setTweak('invertTilt', v)}></TweakToggle>
          <TweakSlider label="左右向き補正" value={t.tiltYawComp} min={-4} max={4} step={0.05}
            onChange={(v) => setTweak('tiltYawComp', v)}></TweakSlider>
          <TweakSlider label="かしげバイアス" value={t.biasRollDeg} min={-30} max={30} step={1} unit="°"
            onChange={(v) => setTweak('biasRollDeg', v)}></TweakSlider>
          <TweakButton label="今のかしげを正面(0)にする" onClick={calibrateTilt}></TweakButton>
          <TweakButton label="かしげをリセット" secondary onClick={resetTilt}></TweakButton>
        </TweakSection>
        <TweakSection label="スライド" collapsible>
          <TweakToggle label="スライド追従（左右・上下）" value={t.slideEnabled}
            onChange={(v) => setTweak('slideEnabled', v)}></TweakToggle>
          <TweakSlider label="左右の量" value={t.slideGain} min={0} max={40} step={1} unit="vw"
            onChange={(v) => setTweak('slideGain', v)}></TweakSlider>
          <TweakSlider label="左右の上限" value={t.slideMax} min={0} max={50} step={1} unit="vw"
            onChange={(v) => setTweak('slideMax', v)}></TweakSlider>
          <TweakToggle label="左右反転" value={t.invertSlide}
            onChange={(v) => setTweak('invertSlide', v)}></TweakToggle>
          <TweakSlider label="左右向き補正" value={t.slidePoseCompX} min={0} max={2} step={0.05}
            onChange={(v) => setTweak('slidePoseCompX', v)}></TweakSlider>
          <TweakSlider label="上下の量" value={t.slideGainY} min={0} max={40} step={1} unit="vh"
            onChange={(v) => setTweak('slideGainY', v)}></TweakSlider>
          <TweakSlider label="上下の上限" value={t.slideMaxY} min={0} max={50} step={1} unit="vh"
            onChange={(v) => setTweak('slideMaxY', v)}></TweakSlider>
          <TweakToggle label="上下反転" value={t.invertSlideY}
            onChange={(v) => setTweak('invertSlideY', v)}></TweakToggle>
          <TweakSlider label="上下向き補正" value={t.slidePoseCompY} min={0} max={2} step={0.05}
            onChange={(v) => setTweak('slidePoseCompY', v)}></TweakSlider>
          <TweakSlider label="動きの滑らかさ" value={t.motionSmoothing} min={0.04} max={0.5} step={0.01}
            onChange={(v) => setTweak('motionSmoothing', v)}></TweakSlider>
        </TweakSection>
        <TweakSection label="ズーム（カメラ距離）" collapsible>
          <TweakToggle label="距離でズーム" value={t.zoomEnabled}
            onChange={(v) => setTweak('zoomEnabled', v)}></TweakToggle>
          <TweakSlider label="ズーム量" value={t.zoomGain} min={0} max={3} step={0.1}
            onChange={(v) => setTweak('zoomGain', v)}></TweakSlider>
          <TweakSlider label="ズーム下限" value={t.zoomMin} min={0.3} max={1} step={0.05}
            onChange={(v) => setTweak('zoomMin', v)}></TweakSlider>
          <TweakSlider label="ズーム上限" value={t.zoomMax} min={1} max={3} step={0.1}
            onChange={(v) => setTweak('zoomMax', v)}></TweakSlider>
          <TweakSlider label="下向き補正" value={t.zoomPitchComp} min={0} max={2} step={0.05}
            onChange={(v) => setTweak('zoomPitchComp', v)}></TweakSlider>
          <TweakSlider label="口開き補正" value={t.zoomMouthComp} min={0} max={1} step={0.05}
            onChange={(v) => setTweak('zoomMouthComp', v)}></TweakSlider>
          <TweakButton label="今の距離を基準にする" onClick={calibrateZoom}></TweakButton>
          <TweakButton label="距離基準をリセット" secondary onClick={resetZoom}></TweakButton>
        </TweakSection>
        <TweakSection label="ズーム（ホイール/ピンチ）" collapsible>
          <TweakSlider label="最小（縮小の下限）" value={t.userZoomMin} min={0.05} max={1} step={0.05}
            onChange={(v) => setTweak('userZoomMin', v)}></TweakSlider>
          <TweakSlider label="最大（拡大の上限）" value={t.userZoomMax} min={1} max={8} step={0.5}
            onChange={(v) => setTweak('userZoomMax', v)}></TweakSlider>
          <TweakSlider label="ホイール感度" value={t.wheelZoomDial} min={0} max={100} step={1}
            onChange={(v) => setTweak('wheelZoomDial', v)}></TweakSlider>
          <TweakSlider label="移動比率（tx→rx）" value={t.moveRatio ?? 1} min={MOVE_RATIO_MIN} max={MOVE_RATIO_MAX} step={0.1} unit="×"
            onChange={(v) => setTweak('moveRatio', v)}></TweakSlider>
          <TweakButton label="表示（移動・ズーム）をリセット" secondary onClick={resetUserTransform}></TweakButton>
        </TweakSection>
        <TweakSection label="推論エンジン" collapsible>
          <TweakToggle label="Web Worker を使う" value={t.useWorker}
            onChange={(v) => setTweak('useWorker', v)}></TweakToggle>
          <TweakRow label="実行先" value={`${engineLabel}${engineNote}`}></TweakRow>
        </TweakSection>
        <TweakSection label="デバッグ" collapsible>
          <TweakToggle label="グリッド表示" value={t.showDebug}
            onChange={(v) => setTweak('showDebug', v)}></TweakToggle>
          <TweakToggle label="表情係数を表示" value={t.showExpr}
            onChange={(v) => setTweak('showExpr', v)}></TweakToggle>
        </TweakSection>
        <TweakSection label="テーマ" collapsible>
          <TweakPresets themes={themes}></TweakPresets>
        </TweakSection>
        {/* リセットはアコーディオン外。常時フッターとして見せる。 */}
        <TweakSection label="リセット"></TweakSection>
        <TweakButton label="設定をデフォルトに戻す" secondary onClick={resetTweaks}></TweakButton>
      </TweaksPanel>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App></App>);
