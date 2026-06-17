import React from 'react';
import ReactDOM from 'react-dom/client';
import charConfig from './character-config';
import { useFacePose } from './face/use-face-pose';
import { parseObsParams } from './obs-mode';

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

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "smoothing": 0.3,
  "sensitivity": 1.0,
  "biasYawDeg": 0,
  "biasPitchDeg": 0,
  "invertX": false,
  "invertY": false,
  "preview": true,
  "mouthGain": 1.3,
  "thHalf": 0.12,
  "thFull": 0.35,
  "release": 0.25,
  "blinkSync": true,
  "blinkSensitivity": 1.0,
  "eyesOpenBias": 0,
  "tiltEnabled": true,
  "tiltGain": 1.0,
  "tiltMax": 20,
  "tiltPivotY": 72,
  "invertTilt": false,
  "slideEnabled": true,
  "slideGain": 12,
  "slideMax": 30,
  "invertSlide": false,
  "slideGainY": 8,
  "slideMaxY": 25,
  "invertSlideY": false,
  "zoomEnabled": true,
  "zoomGain": 1.0,
  "zoomMin": 0.6,
  "zoomMax": 1.8,
  "zoomBaseline": 0,
  "motionSmoothing": 0.2,
  "charSize": 64,
  "bgColor": "#FFF8EE",
  "showDebug": false,
  "showExpr": false,
  "useWorker": true
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

const { rows: ROWS, cols: COLS } = charConfig;
// シート: 目開け×口[とじ/中間/開け] = A/B/C, 目閉じ×口[とじ/中間/開け] = D/E/F
const SHEETS = [
  charConfig.sheets.eyesOpen.close,   // A
  charConfig.sheets.eyesOpen.half,    // B
  charConfig.sheets.eyesOpen.open,    // C
  charConfig.sheets.eyesClosed.close, // D
  charConfig.sheets.eyesClosed.half,  // E
  charConfig.sheets.eyesClosed.open,  // F
];
const sheetFor = (eyesClosed, mouth) => SHEETS[(eyesClosed ? 3 : 0) + mouth];
const SRC = (s, r, c) => charConfig.src(s, r, c);

const BG_OPTIONS = ['#FFF8EE', '#FDEFEF', '#EEF4FB', '#2B2926'];

// 影レベル(0~3, ?shadow=n)→ CSS filter。大きいほど濃く広がる。0 は影なし。
// 高レベルでは「広いぼかし影＋細い輪郭影」を重ねて、透過背景でもはっきり立たせる。
const SHADOW_FILTERS = [
  undefined,
  'drop-shadow(0 2px 6px rgba(0,0,0,0.35))',
  'drop-shadow(0 5px 13px rgba(0,0,0,0.45)) drop-shadow(0 0 2px rgba(0,0,0,0.4))',
  'drop-shadow(0 10px 24px rgba(0,0,0,0.62)) drop-shadow(0 0 5px rgba(0,0,0,0.55))',
];

// 感度を頭の振り角(rad)に変換。感度が高いほど少ない首振りで端まで届く。
const BASE_MAX_YAW = 0.5;
const BASE_MAX_PITCH = 0.4;
const DEG = Math.PI / 180;

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

function App() {
  const [t, setTweak, resetTweaks, themes] = useTweaks(TWEAK_DEFAULTS);
  // OBS ブラウザソース用ステージモード（?obs=1 で背景透過＋UI 非表示）。
  // URL は起動時に固定なので一度だけ解析する。
  const stage = useMemo(
    () => parseObsParams(typeof window !== 'undefined' ? window.location.search : ''),
    [],
  );
  const obsMode = stage.obs;
  const [panelOpen, setPanelOpen] = useState(false); // obsMode 中に T キーで Tweaks を開閉
  const showPreview = t.preview && !obsMode;          // 配信にカメラ枠を出さない
  const [cell, setCell] = useState({ r: 2, c: 2 });
  const [pressed, setPressed] = useState(false);
  const [blink, setBlink] = useState(false);
  const [mouth, setMouth] = useState(0);    // 0:とじ 1:中間 2:開け
  const [exprValues, setExprValues] = useState([]); // 表情係数パネル表示用
  const stageRef = useRef(null);
  const charRef = useRef(null);
  const motionRef = useRef(null);           // 首かしげ・スライド(translate)を直書きするラッパー
  const zoomRef = useRef(null);             // ズーム(scale)を直書きする外側ラッパー
  const target = useRef({ x: 0, y: 0 });   // -1..1（顔向きが書き込む）
  const current = useRef({ x: 0, y: 0 });
  const mouthEnv = useRef(0);               // 口の開きの平滑化エンベロープ
  const rollCurrent = useRef(0);            // 首かしげ角(deg)の平滑化エンベロープ
  const slideCurrent = useRef(0);           // 左右スライド量(vw)の平滑化エンベロープ
  const slideYCurrent = useRef(0);          // 上下スライド量(vh)の平滑化エンベロープ
  const zoomCurrent = useRef(1);            // ズーム率の平滑化エンベロープ（初期=等倍）
  const zoomBaselineRef = useRef(0);        // 初回検出サイズの自動基準（手動較正が無いとき）
  const tweaksRef = useRef(t);
  tweaksRef.current = t;

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
  const { videoRef, poseRef, rollRef, posRef, faceScaleRef, mouthRef, eyesClosedRef, blendshapesRef, status } = useFacePose(target, { enabled: true, poseOptions, positionOptions, preferWorker: t.useWorker });

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
    zoomBaselineRef.current = 0; // 自動基準も捨てて次の検出で取り直す
  }

  // メインループ: 顔向き→グリッド + 口の開き→口パク段階 + まばたき同調
  useEffect(() => {
    let raf;
    let last = { r: 2, c: 2 };
    let lastMouth = 0;
    let lastSwitch = 0;
    let blinkState = false;   // 同調時のヒステリシス状態
    let lastBlinkSet = null;  // 自動↔同調の切替時に必ず反映させるため null 初期化
    function tick(now) {
      const tw = tweaksRef.current;
      // 向き（マウス版と同一ロジック）
      current.current.x += (target.current.x - current.current.x) * tw.smoothing;
      current.current.y += (target.current.y - current.current.y) * tw.smoothing;
      const c = clamp(Math.round((current.current.x + 1) / 2 * (COLS - 1)), 0, COLS - 1);
      const r = clamp(Math.round((current.current.y + 1) / 2 * (ROWS - 1)), 0, ROWS - 1);
      if (r !== last.r || c !== last.c) {
        last = { r, c };
        setCell(last);
      }
      // 口パク: jawOpen(0..1) を envelope（開きは速く・閉じは release で）→ しきい値で3段階に
      const raw = mouthRef.current * tw.mouthGain;
      if (raw > mouthEnv.current) mouthEnv.current += (raw - mouthEnv.current) * 0.6;
      else mouthEnv.current += (raw - mouthEnv.current) * tw.release;
      const lv = mouthEnv.current;
      const m = lv >= tw.thFull ? 2 : lv >= tw.thHalf ? 1 : 0;
      if (m !== lastMouth && now - lastSwitch > 60) {
        lastMouth = m; lastSwitch = now; setMouth(m);
      }
      // まばたき同調: eyeBlink(0..1) をヒステリシスで開閉判定。OFF時は自動まばたきに委譲。
      // 感度が高いほど閉じ判定の閾値が下がり、わずかな閉眼でも瞬きと判定する。
      if (tw.blinkSync) {
        // 開眼基準(eyesOpenBias)を差し引いて 0..1 に再正規化（開=0, 完全閉=1）
        const denom = Math.max(0.05, 1 - tw.eyesOpenBias);
        const closed = clamp((eyesClosedRef.current - tw.eyesOpenBias) / denom, 0, 1);
        const closeTh = clamp(0.5 / tw.blinkSensitivity, 0.15, 0.9);
        const openTh = closeTh * 0.6; // ヒステリシス（チラつき防止）
        if (!blinkState && closed > closeTh) blinkState = true;
        else if (blinkState && closed < openTh) blinkState = false;
        if (blinkState !== lastBlinkSet) { lastBlinkSet = blinkState; setBlink(blinkState); }
      } else {
        lastBlinkSet = null; // 同調へ戻った時に最初のフレームで必ず反映させる
      }
      // 首かしげ(roll)・左右上下スライド・ズーム → ラッパーに直書き（state を介さず再描画ゼロ）。
      // 向き(グリッド)とは独立したレイヤーで、キャラ要素そのものを transform で動かす。
      const tiltTarget = tw.tiltEnabled
        ? clamp((rollRef.current / DEG) * tw.tiltGain * (tw.invertTilt ? -1 : 1), -tw.tiltMax, tw.tiltMax)
        : 0;
      const slideTarget = tw.slideEnabled
        ? clamp(posRef.current.x * tw.slideGain, -tw.slideMax, tw.slideMax)
        : 0;
      const slideYTarget = tw.slideEnabled
        ? clamp(posRef.current.y * tw.slideGainY, -tw.slideMaxY, tw.slideMaxY)
        : 0;
      // ズーム: 見かけサイズ ÷ 基準サイズ が距離比＝ズーム率。基準は手動較正(zoomBaseline)
      // 優先、無ければ初回検出サイズを自動基準にする（起動時はほぼ等倍から始まる）。
      let zoomTarget = 1;
      const sz = faceScaleRef.current;
      if (tw.zoomEnabled && sz > 0) {
        let baseline = tw.zoomBaseline > 0 ? tw.zoomBaseline : zoomBaselineRef.current;
        if (baseline <= 0) { zoomBaselineRef.current = sz; baseline = sz; }
        const ratio = sz / baseline;
        zoomTarget = clamp(1 + (ratio - 1) * tw.zoomGain, tw.zoomMin, tw.zoomMax);
      }
      rollCurrent.current += (tiltTarget - rollCurrent.current) * tw.motionSmoothing;
      slideCurrent.current += (slideTarget - slideCurrent.current) * tw.motionSmoothing;
      slideYCurrent.current += (slideYTarget - slideYCurrent.current) * tw.motionSmoothing;
      zoomCurrent.current += (zoomTarget - zoomCurrent.current) * tw.motionSmoothing;
      const mEl = motionRef.current;
      if (mEl) mEl.style.transform = `translateX(${slideCurrent.current.toFixed(2)}vw) translateY(${slideYCurrent.current.toFixed(2)}vh) rotate(${rollCurrent.current.toFixed(2)}deg)`;
      const zEl = zoomRef.current;
      if (zEl) zEl.style.transform = `scale(${zoomCurrent.current.toFixed(3)})`;
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // 自動まばたき（まばたき同調OFFのときだけ動作。ONのときはメインループが実眼に追従）
  useEffect(() => {
    if (t.blinkSync) return undefined;
    let alive = true;
    let timer;
    const rand = (a, b) => a + Math.random() * (b - a);
    function blinkOnce(dur, after) {
      setBlink(true);
      timer = setTimeout(() => {
        if (!alive) return;
        setBlink(false);
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
  }, [t.blinkSync]);

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
  // 6シート×25セル分の全フレーム（表示は active のみ）
  const allFrames = useMemo(() => {
    const arr = [];
    for (const s of SHEETS) for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) arr.push({ s, r, c });
    return arr;
  }, []);
  const activeSheet = sheetFor(blink, mouth);

  const dark = t.bgColor === '#2B2926';
  const inkColor = dark ? 'rgba(255,248,238,0.85)' : 'rgba(60,48,38,0.8)';
  const subColor = dark ? 'rgba(255,248,238,0.45)' : 'rgba(60,48,38,0.45)';

  const statusText = {
    idle: 'カメラ停止中',
    loading: 'カメラ起動中…',
    error: `エラー: ${status.error || ''}`,
  }[status.phase] || (status.faceDetected ? '顔を検出中' : '顔が見つかりません');
  const statusColor = status.phase === 'error' ? '#E5484D'
    : status.phase === 'running' && status.faceDetected ? '#46C26A'
    : '#E5A23D';

  // 実際の推論先（worker を希望しても dev・非対応・フォールバック時は main）。
  const engineLabel = status.engine === 'worker' ? 'Web Worker'
    : status.engine === 'main' ? 'メインスレッド' : '—';
  const engineNote = t.useWorker && status.engine === 'main' ? '（フォールバック）' : '';
  const onWorker = status.engine === 'worker';

  return (
    <div
      ref={stageRef}
      style={{
        position: 'fixed', inset: 0, background: obsMode ? 'transparent' : t.bgColor,
        overflow: 'hidden', transition: 'background 0.4s ease',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column',
        fontFamily: "'Zen Maru Gothic', sans-serif"
      }}
    >
      {/* 顔向き推定の入力。プレビューOFFでも検出のため要素自体は残し、画面外に逃がす。 */}
      <video
        ref={videoRef}
        playsInline
        muted
        style={showPreview ? {
          position: 'absolute', top: 16, left: 16, width: 'min(160px, 34vw)', borderRadius: 12,
          transform: 'scaleX(-1)', // 鏡像（自撮り表示）
          boxShadow: '0 4px 16px rgba(0,0,0,0.2)', zIndex: 5, background: '#000'
        } : {
          position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none'
        }}
      ></video>

      {/* zoomRef: カメラ距離→ズーム(scale)を中央基準で当てる外側ラッパー。
          motionRef: 首かしげ(rotate)・左右上下スライド(translate)を当てる内側ラッパー。
          内側の charRef は既存の bob アニメ＋押下スケールを保持し、関心を分離する。
          かしげは「首元」を支点にする → 回転原点を下部中央(横50%・縦 tiltPivotY%)に置く。
          translate は transform-origin の影響を受けないのでスライドは不変。
          ズームは別ラッパー(原点=中央)に分けることで、かしげの支点と干渉させない。 */}
      <div ref={zoomRef} style={{ willChange: 'transform' }}>
       <div ref={motionRef} style={{ willChange: 'transform', transformOrigin: `50% ${t.tiltPivotY}%` }}>
        <div
          ref={charRef}
          onPointerDown={() => setPressed(true)}
          onPointerUp={() => setPressed(false)}
          onPointerLeave={() => setPressed(false)}
          className="bob"
          style={{
            position: 'relative',
            width: `${t.charSize * 4 / 3}vmin`, height: `${t.charSize * 4 / 3}vmin`,
            maxWidth: 1200, maxHeight: 1200,
            transform: pressed ? 'scale(0.94)' : 'scale(1)',
            transition: 'transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1)',
            // ?shadow=n (0~3)。大きいほど濃い影で透過背景上の輪郭を立たせる（0 は無し）。
            filter: SHADOW_FILTERS[stage.shadow],
            userSelect: 'none', touchAction: 'none'
          }}
        >
          {allFrames.map(({ s, r, c }) => (
            <img
              key={`${s}${r}${c}`}
              src={SRC(s, r, c)}
              alt=""
              draggable="false"
              style={{
                position: 'absolute', inset: 0, width: '100%', height: '100%',
                opacity: s === activeSheet && r === cell.r && c === cell.c ? 1 : 0,
                pointerEvents: 'none'
              }}
            ></img>
          ))}
        </div>
       </div>
      </div>

      {!obsMode && (
      <div style={{
        position: 'absolute', bottom: '4.5vh', left: 0, right: 0,
        textAlign: 'center', pointerEvents: 'none'
      }}>
        <div style={{ fontSize: 'clamp(18px, 2.4vmin, 26px)', fontWeight: 700, color: inkColor, letterSpacing: '0.18em' }}>ぐるぐるアバター カメラ版</div>
        <div style={{ fontSize: 'clamp(11px, 1.5vmin, 14px)', color: subColor, marginTop: 2, letterSpacing: '0.08em' }}>顔の向き・口の動きに合わせて同調するよ</div>
        <div style={{ fontSize: 'clamp(12px, 1.6vmin, 16px)', color: subColor, marginTop: 6, letterSpacing: '0.08em', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: statusColor, display: 'inline-block' }}></span>
          {statusText}
        </div>
        {/* 実際にどのエンジンで推論しているか（Worker / メインスレッド）を常時表示 */}
        <div style={{ marginTop: 4 }}>
          <span style={{ fontSize: 'clamp(10px, 1.3vmin, 12px)', color: subColor, letterSpacing: '0.06em', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: onWorker ? '#46C26A' : 'rgba(120,120,120,0.55)', display: 'inline-block' }}></span>
            推論: {engineLabel}{engineNote}
          </span>
        </div>
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

      {/* バージョン表記（右下に控えめに）。配信に映らないよう obsMode では非表示。 */}
      {!obsMode && (
      <div style={{
        position: 'absolute', bottom: 10, right: 12, fontSize: 11,
        color: subColor, opacity: 0.65, letterSpacing: '0.04em',
        fontVariantNumeric: 'tabular-nums', pointerEvents: 'none', userSelect: 'none'
      }}>{VERSION_LABEL}</div>
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

      {/* 主な表情係数（MediaPipe blendshapes）パネル。Tweaks のトグルで表示切替 */}
      {!obsMode && t.showExpr ? (
        <div style={{
          position: 'absolute', top: 68, right: 12, width: 'min(220px, 52vw)',
          background: 'rgba(0,0,0,0.55)', color: '#fff', borderRadius: 10,
          padding: '10px 12px', fontSize: 11, fontFamily: 'ui-monospace, monospace',
          zIndex: 6, pointerEvents: 'none', lineHeight: 1.4,
          maxHeight: 'calc(100vh - 84px)', overflow: 'hidden'
        }}>
          <div style={{ fontWeight: 700, marginBottom: 6, letterSpacing: '0.04em' }}>表情係数</div>
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
        </div>
      ) : null}

      {!obsMode && t.showDebug ? (
        <div style={{
          position: 'absolute', top: 16, left: showPreview ? 'calc(min(160px, 34vw) + 30px)' : 16,
          background: 'rgba(0,0,0,0.55)', color: '#fff', borderRadius: 10,
          padding: '10px 12px', fontSize: 12, fontFamily: 'ui-monospace, monospace',
          pointerEvents: 'none', lineHeight: 1.5
        }}>
          <div>row {cell.r} / col {cell.c}</div>
          <div>x {target.current.x.toFixed(2)} / y {target.current.y.toFixed(2)}</div>
          <div>mouth {['とじ', 'はんびらき', 'ぜんかい'][mouth]}</div>
          <div>blink {blink ? '閉' : '開'} {t.blinkSync ? '(同調)' : '(自動)'}</div>
          <div>roll {(rollRef.current / DEG).toFixed(1)}° / slide {posRef.current.x.toFixed(2)},{posRef.current.y.toFixed(2)}</div>
          <div>size {faceScaleRef.current.toFixed(3)} / zoom {zoomCurrent.current.toFixed(2)}x</div>
          <div>engine {status.engine || '—'}{engineNote}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 14px)', gap: 3, marginTop: 6 }}>
            {frames.map(({ r, c }) => (
              <div key={`d${r}-${c}`} style={{
                width: 14, height: 14, borderRadius: 3,
                background: r === cell.r && c === cell.c ? '#FFB13D' : 'rgba(255,255,255,0.22)'
              }}></div>
            ))}
          </div>
        </div>
      ) : null}

      {(!obsMode || panelOpen) && (
      <TweaksPanel>
        <TweakSection label="顔追従"></TweakSection>
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
        <TweakSection label="正面バイアス"></TweakSection>
        <TweakSlider label="左右バイアス" value={t.biasYawDeg} min={-45} max={45} step={1} unit="°"
          onChange={(v) => setTweak('biasYawDeg', v)}></TweakSlider>
        <TweakSlider label="上下バイアス" value={t.biasPitchDeg} min={-45} max={45} step={1} unit="°"
          onChange={(v) => setTweak('biasPitchDeg', v)}></TweakSlider>
        <TweakButton label="今の向きを正面にする" onClick={calibrateCenter}></TweakButton>
        <TweakButton label="正面をリセット" secondary onClick={resetCenter}></TweakButton>
        <TweakSection label="反転"></TweakSection>
        <TweakToggle label="左右反転" value={t.invertX}
          onChange={(v) => setTweak('invertX', v)}></TweakToggle>
        <TweakToggle label="上下反転" value={t.invertY}
          onChange={(v) => setTweak('invertY', v)}></TweakToggle>
        <TweakToggle label="カメラ映像を表示" value={t.preview}
          onChange={(v) => setTweak('preview', v)}></TweakToggle>
        <TweakSection label="首かしげ・スライド"></TweakSection>
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
        <TweakSlider label="動きの滑らかさ" value={t.motionSmoothing} min={0.04} max={0.5} step={0.01}
          onChange={(v) => setTweak('motionSmoothing', v)}></TweakSlider>
        <TweakSection label="ズーム（カメラ距離）"></TweakSection>
        <TweakToggle label="距離でズーム" value={t.zoomEnabled}
          onChange={(v) => setTweak('zoomEnabled', v)}></TweakToggle>
        <TweakSlider label="ズーム量" value={t.zoomGain} min={0} max={3} step={0.1}
          onChange={(v) => setTweak('zoomGain', v)}></TweakSlider>
        <TweakSlider label="ズーム下限" value={t.zoomMin} min={0.3} max={1} step={0.05}
          onChange={(v) => setTweak('zoomMin', v)}></TweakSlider>
        <TweakSlider label="ズーム上限" value={t.zoomMax} min={1} max={3} step={0.1}
          onChange={(v) => setTweak('zoomMax', v)}></TweakSlider>
        <TweakButton label="今の距離を基準にする" onClick={calibrateZoom}></TweakButton>
        <TweakButton label="距離基準をリセット" secondary onClick={resetZoom}></TweakButton>
        <TweakSection label="口パク"></TweakSection>
        <TweakSlider label="口の感度" value={t.mouthGain} min={0.3} max={4} step={0.1}
          onChange={(v) => setTweak('mouthGain', v)}></TweakSlider>
        <TweakSlider label="しきい値（はんびらき）" value={t.thHalf} min={0.02} max={0.5} step={0.01}
          onChange={(v) => setTweak('thHalf', v)}></TweakSlider>
        <TweakSlider label="しきい値（ぜんかい）" value={t.thFull} min={0.05} max={0.8} step={0.01}
          onChange={(v) => setTweak('thFull', v)}></TweakSlider>
        <TweakSlider label="口を閉じる速さ" value={t.release} min={0.05} max={0.5} step={0.01}
          onChange={(v) => setTweak('release', v)}></TweakSlider>
        <TweakSection label="見た目"></TweakSection>
        <TweakSlider label="キャラサイズ" value={t.charSize} min={30} max={92} unit="vmin"
          onChange={(v) => setTweak('charSize', v)}></TweakSlider>
        <TweakColor label="背景色" value={t.bgColor} options={BG_OPTIONS}
          onChange={(v) => setTweak('bgColor', v)}></TweakColor>
        <TweakSection label="推論エンジン"></TweakSection>
        <TweakToggle label="Web Worker を使う" value={t.useWorker}
          onChange={(v) => setTweak('useWorker', v)}></TweakToggle>
        <TweakRow label="実行先" value={`${engineLabel}${engineNote}`}></TweakRow>
        <TweakSection label="デバッグ"></TweakSection>
        <TweakToggle label="グリッド表示" value={t.showDebug}
          onChange={(v) => setTweak('showDebug', v)}></TweakToggle>
        <TweakToggle label="表情係数を表示" value={t.showExpr}
          onChange={(v) => setTweak('showExpr', v)}></TweakToggle>
        <TweakSection label="テーマ"></TweakSection>
        <TweakPresets themes={themes}></TweakPresets>
        <TweakSection label="リセット"></TweakSection>
        <TweakButton label="設定をデフォルトに戻す" secondary onClick={resetTweaks}></TweakButton>
      </TweaksPanel>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App></App>);
