// メインスレッド版 detector。Worker 非対応ブラウザ向けのフォールバック。
// 推論をメインスレッドで実行するため [Violation] は出るが、機能は同じ。
import { createFaceLandmarker } from './face-landmarker';
import { deriveFaceSignals } from './derive-face-signals';

/**
 * @param {{ wasmPath?: string, modelPath?: string }} [paths]
 * @returns {{ ready: Promise<void>, detect: (source: CanvasImageSource, timestamp: number, options?: object) => object|null, close: () => void }}
 */
export function createMainDetector(paths = {}) {
  let landmarker = null;
  let closed = false;

  const ready = createFaceLandmarker(paths).then((lm) => {
    // ready 解決前に close された場合は生成物を即破棄してリークを防ぐ。
    if (closed) {
      lm.close?.();
      return;
    }
    landmarker = lm;
  });

  return {
    ready,
    detect(source, timestamp, options) {
      if (!landmarker) return null;
      const result = landmarker.detectForVideo(source, timestamp);
      return deriveFaceSignals(result, options);
    },
    close() {
      closed = true;
      landmarker?.close?.();
      landmarker = null;
    },
  };
}
