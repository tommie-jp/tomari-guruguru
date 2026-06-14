// useFacePose — Webカメラ＋FaceLandmarker を起動し、毎フレームの顔向きを
// targetRef.current.{x,y}(-1..1) に書き込む React フック。
//
// 描画系(app側)はこの target を平滑化してグリッドに変換するだけ。
// マウス版の pointermove ハンドラを、このフックに置き換えるイメージ。
import React from 'react';
import { createFaceLandmarker } from './face-landmarker';
import { startWebcam, stopWebcam } from './webcam';
import { poseFromMatrix } from './head-pose';

const { useRef, useState, useEffect } = React;

/**
 * @param {{ current: { x: number, y: number } }} targetRef 書き込み先（-1..1）
 * @param {{ enabled?: boolean, poseOptions?: object }} [opts]
 * @returns {{ videoRef: React.RefObject<HTMLVideoElement>, poseRef: { current: { yaw: number, pitch: number } }, status: { phase: string, faceDetected: boolean, error: string|null } }}
 */
export function useFacePose(targetRef, opts = {}) {
  const { enabled = true, poseOptions } = opts;
  const videoRef = useRef(null);
  // 最新の「生の」顔向き角(rad)。正面キャリブレーション用に外へ公開する。
  const poseRef = useRef({ yaw: 0, pitch: 0 });
  const [status, setStatus] = useState({ phase: 'idle', faceDetected: false, error: null });

  // ループ内で最新の poseOptions を参照するための ref（再購読を避ける）
  const poseOptionsRef = useRef(poseOptions);
  poseOptionsRef.current = poseOptions;

  useEffect(() => {
    if (!enabled) {
      setStatus({ phase: 'idle', faceDetected: false, error: null });
      return undefined;
    }

    let landmarker = null;
    let stream = null;
    let raf = 0;
    let cancelled = false;
    let lastVideoTime = -1;
    let lastFaceDetected = null; // 変化時のみ setState して再描画を抑える

    function markFace(detected) {
      if (detected === lastFaceDetected) return;
      lastFaceDetected = detected;
      setStatus((s) => ({ ...s, faceDetected: detected }));
    }

    function loop() {
      if (cancelled) return;
      const video = videoRef.current;
      if (video && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        const result = landmarker.detectForVideo(video, performance.now());
        const matrix = result.facialTransformationMatrixes?.[0]?.data;
        if (matrix) {
          const pose = poseFromMatrix(matrix, poseOptionsRef.current);
          targetRef.current.x = pose.x;
          targetRef.current.y = pose.y;
          poseRef.current.yaw = pose.yaw;
          poseRef.current.pitch = pose.pitch;
          markFace(true);
        } else {
          markFace(false);
        }
      }
      raf = requestAnimationFrame(loop);
    }

    async function init() {
      try {
        setStatus({ phase: 'loading', faceDetected: false, error: null });
        landmarker = await createFaceLandmarker();
        if (cancelled) return;
        stream = await startWebcam(videoRef.current);
        if (cancelled) return;
        setStatus({ phase: 'running', faceDetected: false, error: null });
        raf = requestAnimationFrame(loop);
      } catch (err) {
        if (cancelled) return;
        setStatus({ phase: 'error', faceDetected: false, error: err?.message || String(err) });
      }
    }

    init();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stopWebcam(stream);
      landmarker?.close?.();
    };
  }, [enabled, targetRef]);

  return { videoRef, poseRef, status };
}
