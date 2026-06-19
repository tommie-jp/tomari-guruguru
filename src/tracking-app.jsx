import React from 'react';
import ReactDOM from 'react-dom/client';
import { DrawingUtils, GestureRecognizer, PoseLandmarker } from '@mediapipe/tasks-vision';
import { useHandPose } from './tracking/use-hand-pose';
import { installMobileHardening } from './mobile-hardening.js';
import { applyThemeColor } from './theme-color.js';

const { useState, useEffect, useRef } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "showHands": true,
  "showPose": true,
  "mirror": true,
  "showLabels": true,
  "bgColor": "#11140F"
}/*EDITMODE-END*/;

const BG_OPTIONS = ['#11140F', '#1B2330', '#2B2926', '#0F1A14'];

// ジェスチャー名 → 絵文字＋日本語
const GESTURE_JP = {
  None: '—',
  Closed_Fist: '✊ グー',
  Open_Palm: '✋ パー',
  Pointing_Up: '☝️ 指さし',
  Thumb_Down: '👎 ダウン',
  Thumb_Up: '👍 アップ',
  Victory: '✌️ ピース',
  ILoveYou: '🤟 ILoveYou',
};
const handedJP = (name) => (name === 'Left' ? '左手' : name === 'Right' ? '右手' : name);

function App() {
  const [t, setTweak, resetTweaks, themes] = useTweaks(TWEAK_DEFAULTS);
  const [labels, setLabels] = useState([]); // [{ handed, gesture, score }]
  const canvasRef = useRef(null);
  const tweaksRef = useRef(t);
  tweaksRef.current = t;

  // スマホでのページズーム（背景ピンチ・ダブルタップ）を抑止。1本指スクロール等は温存。
  useEffect(() => installMobileHardening(), []);
  // 背景色に合わせて theme-color（ブラウザ chrome / PWA ステータスバー）を追従させる。
  useEffect(() => { applyThemeColor(t.bgColor); }, [t.bgColor]);

  const { videoRef, handResultRef, poseResultRef, status } = useHandPose({
    enabled: true,
    flags: { hands: t.showHands, pose: t.showPose },
  });

  // 描画ループ: video に重ねた canvas にランドマーク/骨格を毎フレーム描く
  useEffect(() => {
    let raf;
    let drawer = null;
    function draw() {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (canvas && video && video.videoWidth) {
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }
        const ctx = canvas.getContext('2d');
        if (!drawer) drawer = new DrawingUtils(ctx);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // ポーズ(全身骨格)
        const pose = poseResultRef.current;
        if (pose?.landmarks) {
          for (const lm of pose.landmarks) {
            drawer.drawConnectors(lm, PoseLandmarker.POSE_CONNECTIONS, { color: '#46C26A', lineWidth: 4 });
            drawer.drawLandmarks(lm, { color: '#E5A23D', lineWidth: 1, radius: 4 });
          }
        }
        // 手(指の骨格)
        const hand = handResultRef.current;
        if (hand?.landmarks) {
          for (const lm of hand.landmarks) {
            drawer.drawConnectors(lm, GestureRecognizer.HAND_CONNECTIONS, { color: '#3B82F6', lineWidth: 4 });
            drawer.drawLandmarks(lm, { color: '#FFFFFF', lineWidth: 1, radius: 3 });
          }
        }
      }
      raf = requestAnimationFrame(draw);
    }
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ジェスチャー名ラベルを ~8fps で更新
  useEffect(() => {
    const id = setInterval(() => {
      const hand = handResultRef.current;
      if (!hand?.landmarks?.length) { setLabels([]); return; }
      const next = hand.landmarks.map((_, i) => ({
        handed: handedJP(hand.handedness?.[i]?.[0]?.categoryName || ''),
        gesture: hand.gestures?.[i]?.[0]?.categoryName || 'None',
        score: hand.gestures?.[i]?.[0]?.score || 0,
      }));
      setLabels(next);
    }, 120);
    return () => clearInterval(id);
  }, [handResultRef]);

  const statusText = {
    idle: 'カメラ停止中',
    loading: 'モデル読み込み中…',
    error: `エラー: ${status.error || ''}`,
  }[status.phase] || `検出中 — 手 ${status.hands} / ポーズ ${status.poses}`;
  const statusColor = status.phase === 'error' ? '#E5484D'
    : status.phase === 'running' ? '#46C26A' : '#E5A23D';

  const mirrorTransform = t.mirror ? 'scaleX(-1)' : 'none';

  return (
    <div style={{
      position: 'fixed', inset: 0, background: t.bgColor,
      overflow: 'hidden', transition: 'background 0.4s ease',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: 14,
      fontFamily: "'Zen Maru Gothic', sans-serif"
    }}>
      <div style={{
        position: 'relative', width: 'min(94vw, 1024px)', maxHeight: '78vh',
        aspectRatio: '4 / 3', borderRadius: 14, overflow: 'hidden',
        boxShadow: '0 10px 40px rgba(0,0,0,0.4)', background: '#000'
      }}>
        <video
          ref={videoRef} playsInline muted
          style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            objectFit: 'cover', transform: mirrorTransform
          }}
        ></video>
        <canvas
          ref={canvasRef}
          style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            transform: mirrorTransform, pointerEvents: 'none'
          }}
        ></canvas>

        {/* ジェスチャーラベル（左上・鏡像の影響を受けないよう canvas の外） */}
        {t.showLabels && labels.length > 0 ? (
          <div style={{
            position: 'absolute', top: 12, left: 12, display: 'flex', flexDirection: 'column', gap: 6,
            pointerEvents: 'none'
          }}>
            {labels.map((l, i) => (
              <div key={i} style={{
                background: 'rgba(0,0,0,0.6)', color: '#fff', borderRadius: 10,
                padding: '6px 12px', fontSize: 15, fontWeight: 700, letterSpacing: '0.04em'
              }}>
                {l.handed}: {GESTURE_JP[l.gesture] || l.gesture}
                <span style={{ opacity: 0.6, fontWeight: 400, marginLeft: 8, fontSize: 12 }}>
                  {l.gesture !== 'None' ? l.score.toFixed(2) : ''}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'rgba(255,255,255,0.7)', fontSize: 14, letterSpacing: '0.06em' }}>
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: statusColor, display: 'inline-block' }}></span>
        {statusText}
      </div>

      <a href="index.html" style={{
        position: 'absolute', top: 'calc(18px + var(--sat))', right: 'calc(18px + var(--sar))',
        fontSize: 13, fontWeight: 700,
        color: 'rgba(255,255,255,0.6)', textDecoration: 'none', letterSpacing: '0.06em'
      }}>← カメラ版(顔)</a>

      <TweaksPanel>
        <TweakSection label="表示"></TweakSection>
        <TweakToggle label="手・指" value={t.showHands}
          onChange={(v) => setTweak('showHands', v)}></TweakToggle>
        <TweakToggle label="ポーズ(全身)" value={t.showPose}
          onChange={(v) => setTweak('showPose', v)}></TweakToggle>
        <TweakToggle label="ジェスチャー名" value={t.showLabels}
          onChange={(v) => setTweak('showLabels', v)}></TweakToggle>
        <TweakToggle label="鏡像(自撮り)" value={t.mirror}
          onChange={(v) => setTweak('mirror', v)}></TweakToggle>
        <TweakSection label="見た目"></TweakSection>
        <TweakColor label="背景色" value={t.bgColor} options={BG_OPTIONS}
          onChange={(v) => setTweak('bgColor', v)}></TweakColor>
        <TweakSection label="テーマ"></TweakSection>
        <TweakPresets themes={themes}></TweakPresets>
        <TweakSection label="リセット"></TweakSection>
        <TweakButton label="設定をデフォルトに戻す" secondary onClick={resetTweaks}></TweakButton>
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App></App>);
