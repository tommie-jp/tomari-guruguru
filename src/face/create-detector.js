// detector を環境に応じて選ぶ。Web Worker が使えれば Worker 版（推論をメイン
// スレッドから分離）、使えなければメインスレッド版にフォールバックする。
// Worker の初期化に失敗した場合もメインスレッドへ自動フォールバックする。
import { createMainDetector } from './face-detector-main';
import { createWorkerDetector } from './face-detector-worker';

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
  if (supportsWorkerDetector()) {
    const worker = createWorkerDetector(paths);
    try {
      await worker.ready;
      return worker;
    } catch (err) {
      worker.close();
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
