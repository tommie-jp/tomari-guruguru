// MediaPipe FaceLandmarker の初期化ラッパ。
// WASM とモデルはローカル(public/mediapipe/)に同梱したものを参照する
// （オフライン動作・バージョン固定のため。配置は scripts/copy-mediapipe-assets.mjs）。
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { silenceMediaPipeLogs } from './silence-mediapipe-logs';

/**
 * @param {{ wasmPath?: string, modelPath?: string, moduleWasm?: boolean }} [paths]
 *   moduleWasm=true でモジュールワーカー用 ESM ローダ(vision_wasm_module_internal.js)
 *   を使う。クラシック版(vision_wasm_internal.js)は importScripts 用で、module worker
 *   から import() すると "ModuleFactory not set" になるため。
 * @returns {Promise<FaceLandmarker>}
 */
export async function createFaceLandmarker(paths = {}) {
  // WASM 初期化前に、MediaPipe が console.error に吐く glog 形式の
  // info/warning ノイズを間引く（本物の error/fatal は残す）。
  silenceMediaPipeLogs();

  // BASE_URL は本番(/tomari-guruguru/)と開発(/)で変わるため必ず経由する。
  const base = import.meta.env.BASE_URL;
  const wasmPath = paths.wasmPath ?? `${base}mediapipe/wasm`;
  const modelPath = paths.modelPath ?? `${base}mediapipe/face_landmarker.task`;

  // module worker(import() でローダを読む)では ESM 版ローダを手動指定する。
  // それ以外（メインスレッド=script タグ / クラシックワーカー=importScripts）は
  // forVisionTasks に任せる（SIMD 有無を自動判定してクラシック版を選ぶ）。
  const fileset = paths.moduleWasm
    ? {
        wasmLoaderPath: `${wasmPath}/vision_wasm_module_internal.js`,
        wasmBinaryPath: `${wasmPath}/vision_wasm_module_internal.wasm`,
      }
    : await FilesetResolver.forVisionTasks(wasmPath);
  return FaceLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: modelPath,
      delegate: 'GPU', // WebGL が無ければ内部で CPU にフォールバック
    },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFacialTransformationMatrixes: true, // ← 頭部姿勢行列（向き）を出力
    outputFaceBlendshapes: true, // ← 表情ブレンドシェイプ（jawOpen=口の開き）を出力
  });
}
