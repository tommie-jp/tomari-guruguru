// useFacePose — Webカメラ＋FaceLandmarker を起動し、毎フレームの顔向きを
// targetRef.current.{x,y}(-1..1) に書き込む React フック。
//
// 重い推論は detector（Web Worker 優先 / 非対応時はメインスレッド）に委譲する。
// detect の結果 signals を各 ref に反映するだけで、描画系(app側)はこの target を
// 平滑化してグリッドに変換する。マウス版の pointermove ハンドラを置き換えるイメージ。
import React from 'react';
import { startWebcam, stopWebcam } from './webcam';
import { createFaceDetector } from './create-detector';

const { useRef, useState, useEffect } = React;

/**
 * @param {{ current: { x: number, y: number } }} targetRef 書き込み先（-1..1）
 * @param {{ enabled?: boolean, poseOptions?: object }} [opts]
 * @returns {{ videoRef: React.RefObject<HTMLVideoElement>, poseRef: { current: { yaw: number, pitch: number } }, rollRef: { current: number }, posRef: { current: { x: number, y: number } }, faceScaleRef: { current: number }, mouthRef: { current: number }, eyesClosedRef: { current: number }, blendshapesRef: { current: Array<{categoryName: string, score: number}> }, status: { phase: string, faceDetected: boolean, error: string|null } }}
 */
export function useFacePose(targetRef, opts = {}) {
  const { enabled = true, poseOptions, positionOptions } = opts;
  const videoRef = useRef(null);
  // 最新の「生の」顔向き角(rad)。正面キャリブレーション用に外へ公開する。
  const poseRef = useRef({ yaw: 0, pitch: 0 });
  // 最新の roll(首かしげ, rad)。アバターの傾き同調用に外へ公開する。
  const rollRef = useRef(0);
  // 最新の位置(-1..1)。左右・上下スライド追従用に外へ公開する。
  const posRef = useRef({ x: 0, y: 0 });
  // 最新の顔の見かけサイズ(0..1)。カメラ距離→ズーム率に使う。
  const faceScaleRef = useRef(0);
  // 最新の口の開き量(0..1)。口パク描画用に外へ公開する。
  const mouthRef = useRef(0);
  // 最新の目の閉じ具合(0..1)。まばたき同調用に外へ公開する。
  const eyesClosedRef = useRef(0);
  // 最新の表情ブレンドシェイプ一覧（[{categoryName, score}]）。表示パネル用に公開。
  const blendshapesRef = useRef([]);
  const [status, setStatus] = useState({ phase: 'idle', faceDetected: false, error: null });

  // ループ内で最新の poseOptions を参照するための ref（再購読を避ける）
  const poseOptionsRef = useRef(poseOptions);
  poseOptionsRef.current = poseOptions;
  const positionOptionsRef = useRef(positionOptions);
  positionOptionsRef.current = positionOptions;

  useEffect(() => {
    if (!enabled) {
      setStatus({ phase: 'idle', faceDetected: false, error: null });
      return undefined;
    }

    let detector = null;
    let stream = null;
    let raf = 0; // requestAnimationFrame ハンドル（rVFC 非対応ブラウザのフォールバック）
    let rvfc = 0; // requestVideoFrameCallback ハンドル
    let cancelled = false;
    let lastVideoTime = -1;
    let lastFaceDetected = null; // 変化時のみ setState して再描画を抑える

    function markFace(detected) {
      if (detected === lastFaceDetected) return;
      lastFaceDetected = detected;
      setStatus((s) => ({ ...s, faceDetected: detected }));
    }

    // deriveFaceSignals の戻りを各 ref に反映する。
    // 顔ロスト(faceDetected=false)時は向き(target/pose)を据え置き、
    // 傾き・スライド・ズーム・口・目は中立(0/[])へ戻す（固まり防止）。
    function applySignals(s) {
      if (s.faceDetected) {
        targetRef.current.x = s.x;
        targetRef.current.y = s.y;
        poseRef.current.yaw = s.yaw;
        poseRef.current.pitch = s.pitch;
      }
      rollRef.current = s.roll;
      posRef.current.x = s.posX;
      posRef.current.y = s.posY;
      faceScaleRef.current = s.faceScale;
      mouthRef.current = s.mouth;
      eyesClosedRef.current = s.eyesClosed;
      blendshapesRef.current = s.blendshapes;
      markFace(s.faceDetected);
    }

    function currentOptions() {
      return {
        poseOptions: poseOptionsRef.current,
        positionOptions: positionOptionsRef.current,
      };
    }

    // 1フレーム分の推論。新しい映像フレームのときだけ detect を回す。
    // Worker 版の detect は Promise を返すので await し、解決後に次フレームを予約する
    // （= 1フレームずつ処理する自然なバックプレッシャ。処理中に届いた分はスキップ）。
    async function tick() {
      if (cancelled) return;
      const video = videoRef.current;
      if (!video || video.readyState < 2 || video.currentTime === lastVideoTime) return;
      lastVideoTime = video.currentTime;
      try {
        const signals = await detector.detect(video, performance.now(), currentOptions());
        if (!cancelled && signals) applySignals(signals);
      } catch {
        // 単発フレームの失敗は握りつぶしてループ継続（致命的なら init で検出済み）。
      }
    }

    // requestVideoFrameCallback があれば映像フレーム単位で、無ければ rAF で回す。
    // どちらも tick の完了後に次を予約するので、重い推論が rAF ハンドラを
    // ブロックせず Chrome の [Violation] 'requestAnimationFrame' 警告も出ない。
    function scheduleNext() {
      if (cancelled) return;
      const video = videoRef.current;
      const run = () => {
        tick().finally(() => scheduleNext());
      };
      if (video && typeof video.requestVideoFrameCallback === 'function') {
        rvfc = video.requestVideoFrameCallback(run);
      } else {
        raf = requestAnimationFrame(run);
      }
    }

    async function init() {
      try {
        setStatus({ phase: 'loading', faceDetected: false, error: null });
        // BASE_URL は本番(/tomari-guruguru/)と開発(/)で変わる。Worker にも明示的に
        // 絶対パスを渡せるよう、ここで解決してから detector を生成する。
        const base = import.meta.env.BASE_URL;
        detector = await createFaceDetector({
          wasmPath: `${base}mediapipe/wasm`,
          modelPath: `${base}mediapipe/face_landmarker.task`,
        });
        if (cancelled) {
          detector.close?.();
          detector = null;
          return;
        }
        stream = await startWebcam(videoRef.current);
        if (cancelled) return;
        setStatus({ phase: 'running', faceDetected: false, error: null });
        scheduleNext();
      } catch (err) {
        if (cancelled) return;
        setStatus({ phase: 'error', faceDetected: false, error: err?.message || String(err) });
      }
    }

    init();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      const video = videoRef.current;
      if (rvfc && typeof video?.cancelVideoFrameCallback === 'function') {
        video.cancelVideoFrameCallback(rvfc);
      }
      stopWebcam(stream);
      detector?.close?.();
    };
  }, [enabled, targetRef]);

  return { videoRef, poseRef, rollRef, posRef, faceScaleRef, mouthRef, eyesClosedRef, blendshapesRef, status };
}
