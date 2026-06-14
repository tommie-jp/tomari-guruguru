// MediaPipe FaceLandmarker の初期化ラッパ。
// WASM とモデルはローカル(public/mediapipe/)に同梱したものを参照する
// （オフライン動作・バージョン固定のため。配置は scripts/copy-mediapipe-assets.mjs）。
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

/**
 * @param {{ wasmPath?: string, modelPath?: string }} [paths]
 * @returns {Promise<FaceLandmarker>}
 */
export async function createFaceLandmarker(paths = {}) {
  // BASE_URL は本番(/tomari-guruguru/)と開発(/)で変わるため必ず経由する。
  const base = import.meta.env.BASE_URL;
  const wasmPath = paths.wasmPath ?? `${base}mediapipe/wasm`;
  const modelPath = paths.modelPath ?? `${base}mediapipe/face_landmarker.task`;

  const fileset = await FilesetResolver.forVisionTasks(wasmPath);
  return FaceLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: modelPath,
      delegate: 'GPU', // WebGL が無ければ内部で CPU にフォールバック
    },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFacialTransformationMatrixes: true, // ← 頭部姿勢行列を出力させる
    outputFaceBlendshapes: false,
  });
}
