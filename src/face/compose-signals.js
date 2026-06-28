// 入力ソース（向き=顔/マウス × 口=カメラ/マイク/なし）を1つの signals に合成する純ロジック。
//
// 描画パイプライン（computeStateFrame→apply-state）はソース非依存で、唯一この出力契約
//   { x, y, yaw, pitch, roll, posX, posY, faceScale, mouth, eyesClosed }
// だけを読む。camera-app の readSignals() はこの関数に各 ref の現在値を渡すだけにする。
//
// 設計の要点:
// - 向き(x,y)は呼び出し側で決めた「所有者」が既に target に書いている（顔 or マウス）。
// - pose/roll/pos/faceScale は dir==='face' のときだけ実値。マウス向きのときは、たとえ
//   口のためにカメラが動いていても中立(0)にする（頭の揺れを体の向きへ混入させない）。
//   faceScale=0 は「顔ロスト」と同じ中立で、slide/zoom 補正が掛からない（検証済）。
// - 口: camera=顔の顎、mic=マイク音量を micGain で jawOpen 域へ前段スケール、none=0。
//   しきい値・エンベロープは下流(computeStateFrame)の mouthGain/thHalf/thFull/release が
//   担うので、ここでは二重に掛けない（生レベル×micGain だけ）。
// - 目: 実まばたきが取れるのは口=カメラのときだけ。それ以外は 0（自動まばたきに委譲）。

/**
 * @param {Object} refs 各 ref の現在値
 * @param {{ x: number, y: number }} refs.target  向きターゲット(-1..1, 所有者が書込済)
 * @param {{ yaw: number, pitch: number }} refs.pose
 * @param {number} refs.roll
 * @param {number} refs.posX
 * @param {number} refs.posY
 * @param {number} refs.faceScale
 * @param {number} refs.mouth       顔の顎開き(0..1)
 * @param {number} refs.eyesClosed  顔の目閉じ(0..1)
 * @param {Object} opts
 * @param {'face'|'mouse'} opts.direction
 * @param {'camera'|'mic'|'none'} opts.mouthSource
 * @param {number} opts.micGain     マイク RMS → jawOpen 域の前段ゲイン
 * @param {number} opts.micLevel    マイクの生 RMS(0..1 程度)
 * @returns {{ x:number, y:number, yaw:number, pitch:number, roll:number, posX:number, posY:number, faceScale:number, mouth:number, eyesClosed:number }}
 */
export function composeSignals(refs, { direction, mouthSource, micGain, micLevel }) {
  const cameraOn = direction === 'face' || mouthSource === 'camera';
  const usePose = direction === 'face';

  let mouth = 0;
  if (mouthSource === 'camera') mouth = cameraOn ? refs.mouth : 0;
  else if (mouthSource === 'mic') mouth = micLevel * micGain;
  // 'none' は 0（口とじ）

  const eyesClosed = (mouthSource === 'camera' && cameraOn) ? refs.eyesClosed : 0;

  return {
    x: refs.target.x,
    y: refs.target.y,
    yaw: usePose ? refs.pose.yaw : 0,
    pitch: usePose ? refs.pose.pitch : 0,
    roll: usePose ? refs.roll : 0,
    posX: usePose ? refs.posX : 0,
    posY: usePose ? refs.posY : 0,
    faceScale: usePose ? refs.faceScale : 0,
    mouth,
    eyesClosed,
  };
}
