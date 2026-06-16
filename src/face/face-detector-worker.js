// Web Worker 版 detector。重い推論を face-worker.js に投げ、結果(signals)だけ受け取る。
// フレームは createImageBitmap で取り出し transfer で渡す（コピーせず所有権移動）。
// 同時に投げるフレームは常に1つ（呼び出し側が detect を await してから次を出す前提）。

/**
 * @param {{ wasmPath?: string, modelPath?: string }} [paths]
 * @returns {{ ready: Promise<void>, detect: (source: CanvasImageSource, timestamp: number, options?: object) => Promise<object|null>, close: () => void }}
 */
export function createWorkerDetector(paths = {}) {
  const worker = new Worker(new URL('./face-worker.js', import.meta.url), { type: 'module' });

  let pending = null; // 処理中フレームの resolve（在席は最大1）
  let resolveReady;
  let rejectReady;
  let readySettled = false;

  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  function settleReady(ok, err) {
    if (readySettled) return;
    readySettled = true;
    if (ok) resolveReady();
    else rejectReady(err);
  }

  function dropPending() {
    const resolve = pending;
    pending = null;
    resolve?.(null);
  }

  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'ready') {
      settleReady(true);
    } else if (m.type === 'signals') {
      const resolve = pending;
      pending = null;
      resolve?.(m.signals);
    } else if (m.type === 'error') {
      if (!readySettled) settleReady(false, new Error(m.error));
      else dropPending(); // 推論中エラーはそのフレームを捨ててループ継続
    }
  };

  worker.onerror = (e) => {
    if (!readySettled) settleReady(false, new Error(e.message || 'face worker error'));
    else dropPending();
  };

  worker.postMessage({ type: 'init', wasmPath: paths.wasmPath, modelPath: paths.modelPath });

  return {
    ready,
    async detect(source, timestamp, options) {
      const bitmap = await createImageBitmap(source);
      return new Promise((resolve) => {
        pending = resolve;
        worker.postMessage({ type: 'frame', bitmap, timestamp, options }, [bitmap]);
      });
    },
    close() {
      try {
        worker.postMessage({ type: 'close' });
      } catch {
        // 既に terminate 済みなどは無視
      }
      worker.terminate();
      dropPending();
    },
  };
}
