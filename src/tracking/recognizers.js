// 手(ジェスチャー込み) と 全身ポーズ の認識器を生成するラッパ。
// WASM・モデルはローカル(public/mediapipe/)同梱を参照（face と同じ流儀）。
import { FilesetResolver, GestureRecognizer, PoseLandmarker } from '@mediapipe/tasks-vision';

function modelBase() {
  return import.meta.env.BASE_URL; // 本番(/tomari-guruguru/) / 開発(/) を吸収
}

async function fileset() {
  return FilesetResolver.forVisionTasks(`${modelBase()}mediapipe/wasm`);
}

/** 手のランドマーク(21)＋ジェスチャー名＋左右 を返す認識器 */
export async function createGestureRecognizer({ numHands = 2 } = {}) {
  const fs = await fileset();
  return GestureRecognizer.createFromOptions(fs, {
    baseOptions: {
      modelAssetPath: `${modelBase()}mediapipe/gesture_recognizer.task`,
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numHands,
  });
}

/** 全身ポーズ(33点) を返す検出器（lite モデル） */
export async function createPoseLandmarker({ numPoses = 1 } = {}) {
  const fs = await fileset();
  return PoseLandmarker.createFromOptions(fs, {
    baseOptions: {
      modelAssetPath: `${modelBase()}mediapipe/pose_landmarker_lite.task`,
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numPoses,
  });
}
