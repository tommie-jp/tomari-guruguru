import React from 'react';
import ReactDOM from 'react-dom/client';
import charConfig, { avatars, getAvatar } from './character-config';
import { parseCameraParam, resolveCameraDevice, formatCameraLabel } from './camera-config';
import { useFacePose } from './face/use-face-pose';
import { parseObsParams } from './obs-mode';
import { parseRelayMode } from './relay-mode';
import { computeStateFrame, createExprState } from './face/avatar-state';
import { applyState, createSmoothState } from './face/apply-state';
import { encodeStateFrame, decodeStateFrame } from './face/state-codec';
import { useRelay } from './face/use-relay';
import { DraggablePanel } from './draggable-panel.jsx';
import { SpriteAvatar } from './sprite-avatar';

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
  "slideEnabled": true,
  "slideGain": 12,
  "slideMax": 30,
  "invertSlide": true,
  "slideGainY": 8,
  "slideMaxY": 25,
  "invertSlideY": false,
  "slidePoseComp": 0.6,
  "zoomEnabled": true,
  "zoomGain": 1.4,
  "zoomMin": 0.35,
  "zoomMax": 1.5,
  "zoomPitchComp": 1.0,
  "zoomBaseline": 0.387,
  "motionSmoothing": 0.2,
  "moveRatio": 1.0,
  "charSize": 39,
  "shadow": 3,
  "bgColor": "#EEF4FB",
  "showDebug": false,
  "showExpr": false,
  "cameraLabel": "",
  "facingMode": "user",
  "useWorker": true,
  "effGlow": false,
  "effGlowStrength": 3,
  "effGlowColor": "#9FD8FF",
  "effDissolve": false,
  "effDissolveAmount": 0,
  "effDissolveColor": "#7FE0FF"
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

// 感度を頭の振り角(rad)に変換。感度が高いほど少ない首振りで端まで届く。
const BASE_MAX_YAW = 0.5;
const BASE_MAX_PITCH = 0.4;
const DEG = Math.PI / 180;

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

// アバターのユーザー操作（ドラッグ移動・ホイール/ピンチでズーム）の範囲と感度。
// 顔追従とは独立した「表示上の」調整なので relay には送らずローカルのみで完結する。
const USER_ZOOM_MIN = 0.3;
const USER_ZOOM_MAX = 4;
const WHEEL_ZOOM_SENS = 0.0015;     // ホイール deltaY → ズーム倍率（exp で滑らかに）
const DRAG_SQUISH_CANCEL_PX = 4;    // この距離以上動いたら押下スケールを解除しドラッグ扱い

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
  // スマホ用「反映先」トグル。ON のとき操作は local 層（この端末だけ・CEF へ送らない）。
  // PC は Shift キーでも同じ層に切り替わる（layerFor が OR で見る）。ref は effect から参照。
  const [localMode, setLocalMode] = useState(false);
  const localModeRef = useRef(false);
  localModeRef.current = localMode;
  const [sheet, setSheet] = useState(0);    // 表示シート(0..5 = A..F)。apply-state が決める
  const [exprValues, setExprValues] = useState([]); // 表情係数パネル表示用
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

  // 顔向き → target への注入（マウス版の pointermove ハンドラの代わり）
  const poseOptions = {
    maxYaw: BASE_MAX_YAW / t.sensitivity,
    maxPitch: BASE_MAX_PITCH / t.sensitivity,
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
  });

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

    function tick(now) {
      if (mode === 'rx') {
        const frame = latestFrameRef.current;
        if (frame) commit(applyState(frame, viewRef.current, smoothStateRef.current));
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
        commit(applyState(frame, tw, smoothStateRef.current));
      }
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
        pinch.layer.zoom = clamp(pinch.zoom * (dist() / pinch.dist), USER_ZOOM_MIN, USER_ZOOM_MAX);
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
      const layer = layerFor(e);           // Shift+ホイール = local（この端末だけ）
      layer.zoom = clamp(layer.zoom * Math.exp(-e.deltaY * WHEEL_ZOOM_SENS), USER_ZOOM_MIN, USER_ZOOM_MAX);
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

  const frames = useMemo(() => {
    const arr = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) arr.push({ r, c });
    return arr;
  }, []);

  // エフェクト設定（view 由来）→ SpriteAvatar へ。値が変わったときだけ新オブジェクトを作り
  // 参照を安定させる（毎レンダーで setEffect が走るのを防ぐ）。
  const effects = useMemo(() => ({
    glow: { enabled: view.effGlow, strength: view.effGlowStrength, color: view.effGlowColor },
    dissolve: { enabled: view.effDissolve, amount: view.effDissolveAmount, color: view.effDissolveColor },
  }), [
    view.effGlow, view.effGlowStrength, view.effGlowColor,
    view.effDissolve, view.effDissolveAmount, view.effDissolveColor,
  ]);

  const dark = view.bgColor === '#2B2926';
  const inkColor = dark ? 'rgba(255,248,238,0.85)' : 'rgba(60,48,38,0.8)';
  const subColor = dark ? 'rgba(255,248,238,0.45)' : 'rgba(60,48,38,0.45)';

  // 狭い画面では下部の「反映先／リセット／移動比率」コントロールを小型化し、折り返して
  // 左下にまとめる。右下 Tweaks ボタンの幅ぶんを空け、中央タイトル帯は少し上へ逃がす。
  const isNarrow = useIsNarrow();
  const ctl = isNarrow
    ? { font: 11, pad: '5px 9px', gap: 6, dot: 8, slider: 64, mrFont: 10.5, mrPad: '4px 8px' }
    : { font: 13, pad: '7px 12px', gap: 8, dot: 9, slider: 92, mrFont: 12, mrPad: '6px 10px' };

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
        disabled={!showPreview}
        onClose={() => setTweak('preview', false)}
        closeLabel="カメラ映像を隠す"
        defaultStyle={{ top: 16, left: 16 }}
        style={showPreview ? {
          zIndex: 5, borderRadius: 12, overflow: 'hidden', background: '#000',
          boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
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
            display: 'block', width: 'min(160px, 34vw)', height: 'auto',
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
        style={{ willChange: 'transform', touchAction: 'none', cursor: isRx ? 'default' : 'grab' }}
      >
      <div ref={zoomRef} style={{ willChange: 'transform' }}>
       <div ref={motionRef} style={{ willChange: 'transform', transformOrigin: `50% ${view.tiltPivotY}%` }}>
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

      {!obsMode && (
      <div style={{
        position: 'absolute', bottom: isNarrow ? 84 : '4.5vh', left: 0, right: 0,
        textAlign: 'center', pointerEvents: 'none'
      }}>
        <div style={{ fontSize: 'clamp(18px, 2.4vmin, 26px)', fontWeight: 700, color: inkColor, letterSpacing: '0.18em' }}>ぐるぐるアバター カメラ版</div>
        <div style={{ fontSize: 'clamp(11px, 1.5vmin, 14px)', color: subColor, marginTop: 2, letterSpacing: '0.08em' }}>顔の向き・口の動きに合わせて同調するよ</div>
        {/* アバター画像の帰属表示（registry の attribution を per-avatar 表示）。
            01-tomari は原作ろてじん、02 はいらすとや素材＋ChatGPT 生成、のように出し分ける。
            親は pointerEvents:none なので、リンクだけ auto にしてクリック可能にする。
            配信オーバーレイ(obsMode)では他 UI と同様に非表示（このブロックごと !obsMode）。 */}
        <div style={{ fontSize: 'clamp(10px, 1.3vmin, 12px)', color: subColor, marginTop: 4, letterSpacing: '0.04em' }}>
          {avatar.attribution.prefix}<a
            href={avatar.attribution.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: inkColor, textDecoration: 'none', fontWeight: 700, pointerEvents: 'auto' }}
          >{avatar.attribution.name}</a>{avatar.attribution.suffix}
        </div>
        <div style={{ fontSize: 'clamp(12px, 1.6vmin, 16px)', color: subColor, marginTop: 6, letterSpacing: '0.08em', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: statusColor, display: 'inline-block' }}></span>
          {statusText}
        </div>
        {/* 実際にどのエンジンで推論しているか（Worker / メインスレッド）を常時表示。rx は推論なし。 */}
        {!isRx && (
        <div style={{ marginTop: 4 }}>
          <span style={{ fontSize: 'clamp(10px, 1.3vmin, 12px)', color: subColor, letterSpacing: '0.06em', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: onWorker ? '#46C26A' : 'rgba(120,120,120,0.55)', display: 'inline-block' }}></span>
            推論: {engineLabel}{engineNote}
          </span>
        </div>
        )}
        {/* tx（iPhone）: 中継リンクと CEF（受信側）の接続状況を表示する。 */}
        {mode === 'tx' && (
        <div style={{ marginTop: 4 }}>
          <span style={{ fontSize: 'clamp(10px, 1.3vmin, 12px)', color: subColor, letterSpacing: '0.06em', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
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
        position: 'absolute', top: 18, right: 18, fontSize: 13, fontWeight: 700,
        color: subColor, textDecoration: 'none', letterSpacing: '0.06em'
      }}>口パク版 →</a>
      )}

      {!obsMode && (
      <a href="tracking.html" style={{
        position: 'absolute', top: 40, right: 18, fontSize: 13, fontWeight: 700,
        color: subColor, textDecoration: 'none', letterSpacing: '0.06em'
      }}>手・ポーズ →</a>
      )}

      {/* このページURLのQRコード画像へのリンク（スマホで開いてもらう用） */}
      {!obsMode && (
      <a href="camera-qr.svg" target="_blank" rel="noopener" style={{
        position: 'absolute', top: 62, right: 18, fontSize: 13, fontWeight: 700,
        color: subColor, textDecoration: 'none', letterSpacing: '0.06em'
      }}>QRコード</a>
      )}

      {/* GitHub リポジトリへのリンク（外部・別タブ）。配信には映さない。 */}
      {!obsMode && (
      <a href="https://github.com/tommie-jp/guruguru-avatar" target="_blank" rel="noopener noreferrer" style={{
        position: 'absolute', top: 84, right: 18, fontSize: 13, fontWeight: 700,
        color: subColor, textDecoration: 'none', letterSpacing: '0.06em'
      }}>GitHub ↗</a>
      )}

      {/* WS 中継の役割切替リンク。相対パスなので開いているホスト（localhost / Tailscale 等）を
          そのまま引き継ぐ。現在のモードを太字＋色で強調する。配信には映さない。 */}
      {!obsMode && (
      <a href="index.html?tx" style={{
        position: 'absolute', top: 106, right: 18, fontSize: 13,
        fontWeight: mode === 'tx' ? 900 : 700,
        color: mode === 'tx' ? inkColor : subColor,
        textDecoration: 'none', letterSpacing: '0.06em'
      }}>OBS送信側tx →</a>
      )}

      {!obsMode && (
      // rx は既定で透過＋UI 非表示なので、ブラウザのタブで確認できるよう ?obs=0 を付ける。
      <a href="index.html?rx&obs=0" style={{
        position: 'absolute', top: 128, right: 18, fontSize: 13,
        fontWeight: mode === 'rx' ? 900 : 700,
        color: mode === 'rx' ? inkColor : subColor,
        textDecoration: 'none', letterSpacing: '0.06em'
      }}>OBS受信側rx →</a>
      )}

      {/* 「反映先」トグル＋リセット（左下）。ドラッグ移動・ズームを CEF へ送るか、この端末
          だけにするかを切り替える。PC は Shift キーでも一時的に「この端末だけ」になる。
          配信に映さないよう obsMode では非表示。rx は操作しないので非表示。 */}
      {!obsMode && !isRx && (
      <div style={{
        position: 'absolute', bottom: isNarrow ? 14 : 16, left: isNarrow ? 12 : 16, zIndex: 6,
        display: 'flex', flexWrap: 'wrap', gap: ctl.gap, alignItems: 'center',
        // スマホは右下 Tweaks ボタン（約98px）に被らないよう左下に収め、はみ出しは折り返す。
        maxWidth: isNarrow ? 'calc(100vw - 120px)' : 'none',
        fontFamily: "'Zen Maru Gothic', sans-serif"
      }}>
        <button
          type="button"
          onClick={() => setLocalMode((v) => !v)}
          title="ドラッグ移動・ズームの反映先を切替（PC は Shift 併用でも『この端末だけ』）"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            padding: ctl.pad, borderRadius: 999, cursor: 'pointer',
            border: `1.5px solid ${localMode ? '#E8923C' : '#46C26A'}`,
            background: localMode ? 'rgba(232,146,60,0.14)' : 'rgba(70,194,106,0.12)',
            color: inkColor, fontSize: ctl.font, fontWeight: 700, letterSpacing: '0.04em',
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{
            width: ctl.dot, height: ctl.dot, borderRadius: '50%', display: 'inline-block',
            background: localMode ? '#E8923C' : '#46C26A',
          }}></span>
          {localMode ? '反映先: この端末だけ' : '反映先: CEFへ送る'}
        </button>
        <button
          type="button"
          onClick={resetUserTransform}
          title="移動・ズームを中央／等倍に戻す"
          style={{
            padding: ctl.pad, borderRadius: 999, cursor: 'pointer',
            border: `1.5px solid ${subColor}`, background: 'transparent',
            color: subColor, fontSize: ctl.font, fontWeight: 700, letterSpacing: '0.04em',
            whiteSpace: 'nowrap',
          }}
        >リセット</button>
        {/* 移動比率: rx(CEF) の移動量 = tx の移動量 × この値（移動のみ・ズーム対象外）。 */}
        <label
          title="rx(CEF) の移動量 = tx の移動量 × この値（移動のみ・ズームは対象外）"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: ctl.mrPad, borderRadius: 999,
            border: `1.5px solid ${subColor}`, background: 'transparent',
            color: subColor, fontSize: ctl.mrFont, fontWeight: 700, letterSpacing: '0.04em',
            whiteSpace: 'nowrap',
          }}
        >
          <span>移動比率</span>
          <input
            type="range"
            min={MOVE_RATIO_MIN} max={MOVE_RATIO_MAX} step="0.1"
            value={t.moveRatio ?? 1}
            onChange={(e) => setTweak('moveRatio', Number(e.target.value))}
            style={{ width: ctl.slider, accentColor: '#46C26A', cursor: 'pointer' }}
          />
          <span style={{ color: inkColor, fontVariantNumeric: 'tabular-nums', minWidth: 26, textAlign: 'right' }}>
            ×{(t.moveRatio ?? 1).toFixed(1)}
          </span>
        </label>
      </div>
      )}

      {/* バージョン表記（右下に控えめに）。配信に映らないよう obsMode では非表示。
          右下 Tweaks ボタンの真上に逃がして重ならないようにする。狭い画面では
          日付を落とした短縮版にして左下コントロールにも被らない長さにする。 */}
      {!obsMode && (
      <div style={{
        position: 'absolute', bottom: 54, right: isNarrow ? 12 : 16, fontSize: 11,
        color: subColor, opacity: 0.65, letterSpacing: '0.04em', whiteSpace: 'nowrap',
        textAlign: 'right', fontVariantNumeric: 'tabular-nums',
        pointerEvents: 'none', userSelect: 'none'
      }}>{isNarrow ? VERSION_LABEL_SHORT : VERSION_LABEL}</div>
      )}

      {/* カメラ起動エラーの詳細。原因切り分け用に obsMode でも常に表示する
          （OBS ブラウザソース内で ?obs=1 のまま読めるように）。 */}
      {status.phase === 'error' ? (
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          maxWidth: 'min(92vw, 560px)', maxHeight: '80vh', overflow: 'auto',
          background: 'rgba(20,16,14,0.92)', color: '#fff', borderRadius: 12,
          padding: '14px 16px', fontFamily: 'ui-monospace, monospace', fontSize: 12,
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
          onClose={() => setTweak('showExpr', false)}
          closeLabel="表情係数パネルを隠す"
          defaultStyle={{ top: 68, right: 12 }}
          style={{
            width: 'min(220px, 52vw)',
            background: 'rgba(0,0,0,0.55)', color: '#fff', borderRadius: 10,
            padding: '10px 12px', fontSize: 11, fontFamily: 'ui-monospace, monospace',
            zIndex: 6, lineHeight: 1.4,
            maxHeight: 'calc(100vh - 84px)', overflow: 'hidden',
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6, letterSpacing: '0.04em', paddingRight: 18 }}>表情係数</div>
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
          onClose={() => setTweak('showDebug', false)}
          closeLabel="デバッグ表示を隠す"
          defaultStyle={{ top: 16, left: showPreview ? 'calc(min(160px, 34vw) + 30px)' : 16 }}
          style={{
            background: 'rgba(0,0,0,0.55)', color: '#fff', borderRadius: 10,
            padding: '10px 12px', fontSize: 12, fontFamily: 'ui-monospace, monospace',
            lineHeight: 1.5,
          }}
        >
          <div style={{ paddingRight: 18 }}>row {cell.r} / col {cell.c}</div>
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
        <TweakSection label="アバター" collapsible>
          {avatarParam ? (
            <TweakRow label="キャラ" value="URL固定">
              <span style={{ fontSize: 13, opacity: 0.8 }}>{avatar.displayName}</span>
            </TweakRow>
          ) : (
            <TweakSelect label="キャラ" value={avatar.id}
              options={avatars.map((a) => ({ value: a.id, label: a.displayName }))}
              onChange={(v) => setTweak('avatarId', v)}></TweakSelect>
          )}
          <TweakRow label="クレジット">
            <span style={{ fontSize: 12, opacity: 0.7, lineHeight: 1.4 }}>{avatar.credit}</span>
          </TweakRow>
        </TweakSection>
        <TweakSection label="カメラ" collapsible>
          {cameraParam ? (
            <TweakRow label="カメラ" value="URL固定">
              <span style={{ fontSize: 13, opacity: 0.8 }}>{cameraLabelEff}</span>
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
        <TweakSection label="正面バイアス" collapsible>
          <TweakSlider label="左右バイアス" value={t.biasYawDeg} min={-45} max={45} step={1} unit="°"
            onChange={(v) => setTweak('biasYawDeg', v)}></TweakSlider>
          <TweakSlider label="上下バイアス" value={t.biasPitchDeg} min={-45} max={45} step={1} unit="°"
            onChange={(v) => setTweak('biasPitchDeg', v)}></TweakSlider>
          <TweakButton label="今の向きを正面にする" onClick={calibrateCenter}></TweakButton>
          <TweakButton label="正面をリセット" secondary onClick={resetCenter}></TweakButton>
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
          <TweakSlider label="上下の量" value={t.slideGainY} min={0} max={40} step={1} unit="vh"
            onChange={(v) => setTweak('slideGainY', v)}></TweakSlider>
          <TweakSlider label="上下の上限" value={t.slideMaxY} min={0} max={50} step={1} unit="vh"
            onChange={(v) => setTweak('slideMaxY', v)}></TweakSlider>
          <TweakToggle label="上下反転" value={t.invertSlideY}
            onChange={(v) => setTweak('invertSlideY', v)}></TweakToggle>
          <TweakSlider label="向き補正" value={t.slidePoseComp} min={0} max={2} step={0.05}
            onChange={(v) => setTweak('slidePoseComp', v)}></TweakSlider>
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
          <TweakButton label="今の距離を基準にする" onClick={calibrateZoom}></TweakButton>
          <TweakButton label="距離基準をリセット" secondary onClick={resetZoom}></TweakButton>
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
