import React from 'react';
import ReactDOM from 'react-dom/client';
import charConfig from './character-config';
import { useFacePose } from './face/use-face-pose';

const { useState, useEffect, useRef, useMemo } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "smoothing": 0.3,
  "sensitivity": 1.0,
  "invertX": false,
  "invertY": false,
  "preview": true,
  "charSize": 64,
  "bgColor": "#FFF8EE",
  "showDebug": false
}/*EDITMODE-END*/;

const { rows: ROWS, cols: COLS } = charConfig;
const SRC = (r, c) => charConfig.src(charConfig.sheets.eyesOpen.close, r, c);
const BLINK_SRC = (r, c) => charConfig.src(charConfig.sheets.eyesClosed.close, r, c);

const BG_OPTIONS = ['#FFF8EE', '#FDEFEF', '#EEF4FB', '#2B2926'];

// 感度を頭の振り角(rad)に変換。感度が高いほど少ない首振りで端まで届く。
const BASE_MAX_YAW = 0.5;
const BASE_MAX_PITCH = 0.4;

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [cell, setCell] = useState({ r: 2, c: 2 });
  const [pressed, setPressed] = useState(false);
  const [blink, setBlink] = useState(false);
  const stageRef = useRef(null);
  const charRef = useRef(null);
  const target = useRef({ x: 0, y: 0 });   // -1..1（顔向きが書き込む）
  const current = useRef({ x: 0, y: 0 });
  const tweaksRef = useRef(t);
  tweaksRef.current = t;

  // 顔向き → target への注入（マウス版の pointermove ハンドラの代わり）
  const poseOptions = {
    maxYaw: BASE_MAX_YAW / t.sensitivity,
    maxPitch: BASE_MAX_PITCH / t.sensitivity,
    invertX: t.invertX,
    invertY: t.invertY,
  };
  const { videoRef, status } = useFacePose(target, { enabled: true, poseOptions });

  // 平滑化してグリッドに変換（マウス版と同一ロジック）
  useEffect(() => {
    let raf;
    let last = { r: 2, c: 2 };
    function tick() {
      const k = tweaksRef.current.smoothing;
      current.current.x += (target.current.x - current.current.x) * k;
      current.current.y += (target.current.y - current.current.y) * k;
      const c = clamp(Math.round((current.current.x + 1) / 2 * (COLS - 1)), 0, COLS - 1);
      const r = clamp(Math.round((current.current.y + 1) / 2 * (ROWS - 1)), 0, ROWS - 1);
      if (r !== last.r || c !== last.c) {
        last = { r, c };
        setCell(last);
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // 自動まばたき（app.jsx と同一）
  useEffect(() => {
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
  }, []);

  const frames = useMemo(() => {
    const arr = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) arr.push({ r, c });
    return arr;
  }, []);

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
          position: 'absolute', top: 16, left: 16, width: 160, borderRadius: 12,
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
        {frames.map(({ r, c }) => (
          <img
            key={`${r}-${c}`}
            src={SRC(r, c)}
            alt=""
            draggable="false"
            style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%',
              opacity: r === cell.r && c === cell.c ? 1 : 0,
              pointerEvents: 'none'
            }}
          ></img>
        ))}
        {blink ? (
          <img
            src={BLINK_SRC(cell.r, cell.c)}
            alt=""
            draggable="false"
            style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%',
              pointerEvents: 'none'
            }}
          ></img>
        ) : null}
      </div>

      <div style={{
        position: 'absolute', bottom: '4.5vh', left: 0, right: 0,
        textAlign: 'center', pointerEvents: 'none'
      }}>
        <div style={{ fontSize: 'clamp(18px, 2.4vmin, 26px)', fontWeight: 700, color: inkColor, letterSpacing: '0.18em' }}>トマリぐるぐる カメラ版</div>
        <div style={{ fontSize: 'clamp(12px, 1.6vmin, 16px)', color: subColor, marginTop: 6, letterSpacing: '0.08em', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: statusColor, display: 'inline-block' }}></span>
          {statusText}
        </div>
      </div>

      <a href="talk.html" style={{
        position: 'absolute', top: 18, right: 18, fontSize: 13, fontWeight: 700,
        color: subColor, textDecoration: 'none', letterSpacing: '0.06em'
      }}>口パク版 →</a>

      {t.showDebug ? (
        <div style={{
          position: 'absolute', top: 16, left: t.preview ? 190 : 16,
          background: 'rgba(0,0,0,0.55)', color: '#fff', borderRadius: 10,
          padding: '10px 12px', fontSize: 12, fontFamily: 'ui-monospace, monospace',
          pointerEvents: 'none', lineHeight: 1.5
        }}>
          <div>row {cell.r} / col {cell.c}</div>
          <div>x {target.current.x.toFixed(2)} / y {target.current.y.toFixed(2)}</div>
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
        <TweakToggle label="左右反転" value={t.invertX}
          onChange={(v) => setTweak('invertX', v)}></TweakToggle>
        <TweakToggle label="上下反転" value={t.invertY}
          onChange={(v) => setTweak('invertY', v)}></TweakToggle>
        <TweakToggle label="カメラ映像を表示" value={t.preview}
          onChange={(v) => setTweak('preview', v)}></TweakToggle>
        <TweakSection label="見た目"></TweakSection>
        <TweakSlider label="キャラサイズ" value={t.charSize} min={30} max={92} unit="vmin"
          onChange={(v) => setTweak('charSize', v)}></TweakSlider>
        <TweakColor label="背景色" value={t.bgColor} options={BG_OPTIONS}
          onChange={(v) => setTweak('bgColor', v)}></TweakColor>
        <TweakSection label="デバッグ"></TweakSection>
        <TweakToggle label="グリッド表示" value={t.showDebug}
          onChange={(v) => setTweak('showDebug', v)}></TweakToggle>
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App></App>);
