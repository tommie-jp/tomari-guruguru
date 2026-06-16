// 顔推論 Web Worker。重い detectForVideo をメインスレッドから分離する。
// メイン側ドライバは face-detector-worker.js。やり取りするメッセージ:
//   ← { type: 'init', wasmPath, modelPath }       初期化要求
//   → { type: 'ready' }                            初期化完了
//   ← { type: 'frame', bitmap, timestamp, options } 1フレーム推論（bitmap は transfer）
//   → { type: 'signals', signals }                 推論結果（deriveFaceSignals の戻り）
//   ← { type: 'close' }                            破棄
//   → { type: 'error', error }                     初期化失敗 or フレーム処理失敗
//
// detect＋後処理を Worker 内で済ませ、小さな signals だけ返す（生ランドマークは送らない）。
import { createFaceLandmarker } from './face-landmarker';
import { deriveFaceSignals } from './derive-face-signals';

let landmarker = null;

self.onmessage = async (e) => {
  const msg = e.data;

  if (msg.type === 'init') {
    try {
      landmarker = await createFaceLandmarker({
        wasmPath: msg.wasmPath,
        modelPath: msg.modelPath,
      });
      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'error', error: err?.message || String(err) });
    }
    return;
  }

  if (msg.type === 'frame') {
    const { bitmap, timestamp, options } = msg;
    if (!landmarker) {
      bitmap?.close?.();
      return;
    }
    try {
      const result = landmarker.detectForVideo(bitmap, timestamp);
      const signals = deriveFaceSignals(result, options);
      self.postMessage({ type: 'signals', signals });
    } catch (err) {
      self.postMessage({ type: 'error', error: err?.message || String(err) });
    } finally {
      // ImageBitmap は transfer で所有権を受けているので必ず解放する。
      bitmap?.close?.();
    }
    return;
  }

  if (msg.type === 'close') {
    landmarker?.close?.();
    landmarker = null;
  }
};
