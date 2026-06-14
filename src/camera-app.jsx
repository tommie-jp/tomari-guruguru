import React from 'react';
import ReactDOM from 'react-dom/client';
import charConfig from './character-config';
import { useFacePose } from './face/use-face-pose';

const { useState, useEffect, useRef, useMemo } = React;

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
  "charSize": 64,
  "bgColor": "#FFF8EE",
  "showDebug": false,
  "showExpr": false
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

// 感度を頭の振り角(rad)に変換。感度が高いほど少ない首振りで端まで届く。
const BASE_MAX_YAW = 0.5;
const BASE_MAX_PITCH = 0.4;
const DEG = Math.PI / 180;

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

function App() {
  const [t, setTweak, resetTweaks] = useTweaks(TWEAK_DEFAULTS);
  const [cell, setCell] = useState({ r: 2, c: 2 });
  const [pressed, setPressed] = useState(false);
  const [blink, setBlink] = useState(false);
  const [mouth, setMouth] = useState(0);    // 0:とじ 1:中間 2:開け
  const [exprValues, setExprValues] = useState([]); // 表情係数パネル表示用
  const stageRef = useRef(null);
  const charRef = useRef(null);
  const target = useRef({ x: 0, y: 0 });   // -1..1（顔向きが書き込む）
  const current = useRef({ x: 0, y: 0 });
  const mouthEnv = useRef(0);               // 口の開きの平滑化エンベロープ
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
  const { videoRef, poseRef, mouthRef, eyesClosedRef, blendshapesRef, status } = useFacePose(target, { enabled: true, poseOptions });

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

  return (
    <div
      ref={stageRef}
      style={{
        position: 'fixed', inset: 0, background: t.bgColor,
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
        style={t.preview ? {
          position: 'absolute', top: 16, left: 16, width: 'min(160px, 34vw)', borderRadius: 12,
          transform: 'scaleX(-1)', // 鏡像（自撮り表示）
          boxShadow: '0 4px 16px rgba(0,0,0,0.2)', zIndex: 5, background: '#000'
        } : {
          position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none'
        }}
      ></video>

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

      <div style={{
        position: 'absolute', bottom: '4.5vh', left: 0, right: 0,
        textAlign: 'center', pointerEvents: 'none'
      }}>
        <div style={{ fontSize: 'clamp(18px, 2.4vmin, 26px)', fontWeight: 700, color: inkColor, letterSpacing: '0.18em' }}>トマリぐるぐる カメラ版</div>
        <div style={{ fontSize: 'clamp(11px, 1.5vmin, 14px)', color: subColor, marginTop: 2, letterSpacing: '0.08em' }}>顔の向き・口の動きに合わせて同調するよ</div>
        <div style={{ fontSize: 'clamp(12px, 1.6vmin, 16px)', color: subColor, marginTop: 6, letterSpacing: '0.08em', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: statusColor, display: 'inline-block' }}></span>
          {statusText}
        </div>
      </div>

      <a href="talk.html" style={{
        position: 'absolute', top: 18, right: 18, fontSize: 13, fontWeight: 700,
        color: subColor, textDecoration: 'none', letterSpacing: '0.06em'
      }}>口パク版 →</a>

      {/* このページURLのQRコード画像へのリンク（スマホで開いてもらう用） */}
      <a href="camera-qr.svg" target="_blank" rel="noopener" style={{
        position: 'absolute', top: 40, right: 18, fontSize: 13, fontWeight: 700,
        color: subColor, textDecoration: 'none', letterSpacing: '0.06em'
      }}>QRコード</a>

      {/* 主な表情係数（MediaPipe blendshapes）パネル。Tweaks のトグルで表示切替 */}
      {t.showExpr ? (
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

      {t.showDebug ? (
        <div style={{
          position: 'absolute', top: 16, left: t.preview ? 'calc(min(160px, 34vw) + 30px)' : 16,
          background: 'rgba(0,0,0,0.55)', color: '#fff', borderRadius: 10,
          padding: '10px 12px', fontSize: 12, fontFamily: 'ui-monospace, monospace',
          pointerEvents: 'none', lineHeight: 1.5
        }}>
          <div>row {cell.r} / col {cell.c}</div>
          <div>x {target.current.x.toFixed(2)} / y {target.current.y.toFixed(2)}</div>
          <div>mouth {['とじ', 'はんびらき', 'ぜんかい'][mouth]}</div>
          <div>blink {blink ? '閉' : '開'} {t.blinkSync ? '(同調)' : '(自動)'}</div>
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
        <TweakSection label="デバッグ"></TweakSection>
        <TweakToggle label="グリッド表示" value={t.showDebug}
          onChange={(v) => setTweak('showDebug', v)}></TweakToggle>
        <TweakToggle label="表情係数を表示" value={t.showExpr}
          onChange={(v) => setTweak('showExpr', v)}></TweakToggle>
        <TweakSection label="リセット"></TweakSection>
        <TweakButton label="設定をデフォルトに戻す" secondary onClick={resetTweaks}></TweakButton>
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App></App>);
