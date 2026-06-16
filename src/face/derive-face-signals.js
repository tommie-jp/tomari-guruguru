// MediaPipe FaceLandmarker の生 result を、アバター追従系が使う「信号」へ変換する
// 純関数（副作用なし・DOM 非依存）。メインスレッド版と Web Worker 版の両パスで共有し、
// Worker 側ではこの小さな signals だけを postMessage で返す（生ランドマークは送らない）。
//
// faceDetected=false（顔ロスト）のときは x/y/yaw/pitch を含めない。呼び出し側は
// 「向き(target/pose)は据え置き、傾き・スライド・ズーム・口・目だけ中立へ戻す」挙動にする。
import { poseFromMatrix } from './head-pose';
import { facePositionFromLandmarks } from './face-position';
import { faceScaleFromLandmarks } from './face-scale';
import { mouthOpenFromBlendshapes } from './mouth';
import { eyesClosedFromBlendshapes } from './eyes';

/**
 * @typedef {Object} FaceSignals
 * @property {boolean} faceDetected
 * @property {number} [x]      顔の向き(-1..1) 横。faceDetected=true のときのみ
 * @property {number} [y]      顔の向き(-1..1) 縦。faceDetected=true のときのみ
 * @property {number} [yaw]    生のヨー角(rad)。faceDetected=true のときのみ
 * @property {number} [pitch]  生のピッチ角(rad)。faceDetected=true のときのみ
 * @property {number} roll     首かしげ(rad)。ロスト時 0
 * @property {number} posX     左右スライド(-1..1)。ロスト時 0
 * @property {number} posY     上下スライド(-1..1)。ロスト時 0
 * @property {number} faceScale 見かけサイズ(0..1)。ロスト時 0
 * @property {number} mouth    口の開き(0..1)。ロスト時 0
 * @property {number} eyesClosed 目の閉じ(0..1)。ロスト時 0
 * @property {Array<{categoryName: string, score: number}>} blendshapes ロスト時 []
 */

/**
 * @param {object|null|undefined} result FaceLandmarker.detectForVideo の戻り
 * @param {{ poseOptions?: object, positionOptions?: object }} [options]
 * @returns {FaceSignals}
 */
export function deriveFaceSignals(result, options = {}) {
  const matrix = result?.facialTransformationMatrixes?.[0]?.data;
  if (!matrix) {
    // 顔ロスト: 向き(x/y/yaw/pitch)は返さず据え置きにし、他は中立へ。
    return {
      faceDetected: false,
      roll: 0,
      posX: 0,
      posY: 0,
      faceScale: 0,
      mouth: 0,
      eyesClosed: 0,
      blendshapes: [],
    };
  }

  const pose = poseFromMatrix(matrix, options.poseOptions);
  const landmarks = result.faceLandmarks?.[0];
  const pos = facePositionFromLandmarks(landmarks, options.positionOptions);
  const categories = result.faceBlendshapes?.[0]?.categories || [];

  return {
    faceDetected: true,
    x: pose.x,
    y: pose.y,
    yaw: pose.yaw,
    pitch: pose.pitch,
    roll: pose.roll,
    posX: pos.x,
    posY: pos.y,
    faceScale: faceScaleFromLandmarks(landmarks),
    mouth: mouthOpenFromBlendshapes(categories),
    eyesClosed: eyesClosedFromBlendshapes(categories),
    blendshapes: categories,
  };
}
