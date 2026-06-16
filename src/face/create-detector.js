// detector を環境に応じて選ぶ。
//
// Web Worker 版は「本番ビルドのときだけ」有効化する。Vite dev では worker が
// module worker として配信され、MediaPipe が /public 配下の wasm ローダを
// import() で読もうとして弾かれる（public ファイルはモジュールとして取り込めない）。
// 本番ビルドでは worker がクラシック(iife)としてバンドルされ、wasm も静的配信
// （Vite の変換を通らない）なので問題なく読める。
//
// dev はメインスレッド版で動かす（requestVideoFrameCallback 化済みなので
// [Violation] も出ない）。worker モジュールは動的 import で本番branchからのみ
// 参照し、dev では Vite に一切バンドルさせない（オーバーレイの発生源を断つ）。
import { createMainDetector } from './face-detector-main';

// Worker 版に必要な API が揃っているか。OffscreenCanvas は Worker 内 GPU(WebGL)に必須。
export function supportsWorkerDetector() {
  return (
    typeof Worker !== 'undefined' &&
    typeof createImageBitmap === 'function' &&
    typeof OffscreenCanvas !== 'undefined'
  );
}

/**
 * 初期化済みの detector を返す（ready 解決済み）。
 * @param {{ wasmPath?: string, modelPath?: string }} [paths]
 */
export async function createFaceDetector(paths = {}) {
  if (import.meta.env.PROD && supportsWorkerDetector()) {
    try {
      const { createWorkerDetector } = await import('./face-detector-worker.js');
      const worker = createWorkerDetector(paths);
      await worker.ready;
      return worker;
    } catch (err) {
      // Worker 初期化失敗 → メインスレッドにフォールバック。
      // eslint-disable-next-line no-console
      console.warn(
        '[useFacePose] Web Worker の初期化に失敗。メインスレッドにフォールバックします:',
        err,
      );
    }
  }

  const main = createMainDetector(paths);
  await main.ready;
  return main;
}
