// useHandPose — Webカメラを起動し、毎フレーム 手(ジェスチャー)＋ポーズ を認識して
// 最新結果を ref に書き込む React フック。描画は呼び出し側(canvas)に委ねる。
import React from 'react';
import { createGestureRecognizer, createPoseLandmarker } from './recognizers';
import { startWebcam, stopWebcam } from '../face/webcam';

const { useRef, useState, useEffect } = React;

/**
 * @param {{ enabled?: boolean, flags?: { hands?: boolean, pose?: boolean } }} [opts]
 * @returns {{ videoRef, handResultRef, poseResultRef, status }}
 */
export function useHandPose(opts = {}) {
  const { enabled = true } = opts;
  const videoRef = useRef(null);
  const handResultRef = useRef(null); // GestureRecognizerResult | null
  const poseResultRef = useRef(null); // PoseLandmarkerResult | null
  const [status, setStatus] = useState({ phase: 'idle', error: null, hands: 0, poses: 0 });

  // 検出ON/OFFフラグを毎フレーム参照（再購読を避ける）
  const flagsRef = useRef(opts.flags);
  flagsRef.current = opts.flags;

  useEffect(() => {
    if (!enabled) {
      setStatus({ phase: 'idle', error: null, hands: 0, poses: 0 });
      return undefined;
    }
    let gesture = null;
    let pose = null;
    let stream = null;
    let raf = 0;
    let cancelled = false;
    let lastTime = -1;
    let lastCount = -1;

    function loop() {
      if (cancelled) return;
      const video = videoRef.current;
      if (video && video.readyState >= 2 && video.currentTime !== lastTime) {
        lastTime = video.currentTime;
        const ts = performance.now();
        const f = flagsRef.current || {};
        handResultRef.current = f.hands !== false && gesture
          ? gesture.recognizeForVideo(video, ts) : null;
        poseResultRef.current = f.pose !== false && pose
          ? pose.detectForVideo(video, ts) : null;
        // 検出数が変わった時だけ軽く state 更新（毎フレーム再描画を避ける）
        const h = handResultRef.current?.landmarks?.length || 0;
        const p = poseResultRef.current?.landmarks?.length || 0;
        const key = h * 10 + p;
        if (key !== lastCount) {
          lastCount = key;
          setStatus((s) => ({ ...s, hands: h, poses: p }));
        }
      }
      raf = requestAnimationFrame(loop);
    }

    async function init() {
      try {
        setStatus({ phase: 'loading', error: null, hands: 0, poses: 0 });
        [gesture, pose] = await Promise.all([
          createGestureRecognizer(),
          createPoseLandmarker(),
        ]);
        if (cancelled) return;
        stream = await startWebcam(videoRef.current);
        if (cancelled) return;
        setStatus({ phase: 'running', error: null, hands: 0, poses: 0 });
        raf = requestAnimationFrame(loop);
      } catch (err) {
        if (cancelled) return;
        setStatus({ phase: 'error', error: err?.message || String(err), hands: 0, poses: 0 });
      }
    }
    init();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stopWebcam(stream);
      gesture?.close?.();
      pose?.close?.();
    };
  }, [enabled]);

  return { videoRef, handResultRef, poseResultRef, status };
}
