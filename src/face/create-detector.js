// detector を環境に応じて選ぶ。Web Worker が使えれば Worker 版（推論をメイン
// スレッドから分離）、使えなければメインスレッド版にフォールバックする。
//
// dev 特有の事情: Vite dev は worker を module worker として配信し、MediaPipe が
// /public 配下の wasm ローダを import() で読もうとして弾く（public ファイルは
// モジュールとして取り込めない）。そこで dev のときだけ worker の wasm を CDN
// (jsDelivr) から読む。CDN は別オリジンなので Vite の変換を通らず import() できる。
// 本番ビルドでは wasm も自前ホスト(/public)を静的配信するためそのまま読める
// （＝本番はオフライン動作・バージョン固定）。
import { createMainDetector } from './face-detector-main';

// dev で worker が読む wasm の CDN。バージョンは package.json の
// @mediapipe/tasks-vision に合わせる（ズレると別バージョンを取得してしまう）。
const MEDIAPIPE_VERSION = '0.10.35';
const DEV_WORKER_WASM_CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;

// Worker 版に必要な API が揃っているか。OffscreenCanvas は Worker 内 GPU(WebGL)に必須。
export function supportsWorkerDetector() {
  return (
    typeof Worker !== 'undefined' &&
    typeof createImageBitmap === 'function' &&
    typeof OffscreenCanvas !== 'undefined'
  );
}

/**
 * 初期化済みの detector を返す（ready 解決済み）。返り値の `engine` で
 * 実際に動いているのが 'worker' か 'main' かを判別できる。
 * @param {{ wasmPath?: string, modelPath?: string }} [paths]
 * @param {{ preferWorker?: boolean }} [opts] preferWorker=false で常にメインスレッド
 */
export async function createFaceDetector(paths = {}, { preferWorker = true } = {}) {
  if (preferWorker && supportsWorkerDetector()) {
    try {
      const { createWorkerDetector } = await import('./face-detector-worker.js');
      // dev は Vite が module worker で配信するため、CDN の ESM 版ローダ
      // (vision_wasm_module_internal.js)を import() で読む（moduleWasm:true）。
      // 本番は ?worker のクラシックワーカーなので従来どおり /public + importScripts。
      // model(.task) はどちらも fetch 読み込みなので /public のまま。
      const workerPaths = import.meta.env.DEV
        ? { ...paths, wasmPath: DEV_WORKER_WASM_CDN, moduleWasm: true }
        : paths;
      const worker = createWorkerDetector(workerPaths);
      await worker.ready;
      return worker;
    } catch (err) {
      // Worker 初期化失敗（dev でオフライン等）→ メインスレッドにフォールバック。
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
