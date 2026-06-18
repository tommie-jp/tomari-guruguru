// 1フレーム分の signals を「各 ref に書き込む値」へ変換する純関数（副作用なし）。
//
// 唯一の非自明ルールは顔ロスト時の扱い:
//   - 顔検出(faceDetected=true): 向き(target/pose)も含め signals の値をそのまま使う。
//   - 顔ロスト(faceDetected=false): 向き(target/pose)は prev のまま据え置き（カクッと
//     正面に戻さない）、その他(roll/pos/scale/mouth/eyes/blendshapes)は signals の値
//     （deriveFaceSignals がロスト時に 0/[] を返すので、結果として中立へ戻る）を使う。
//
// 戻り値は常に新しいオブジェクト（prev を破壊しない）。適用側はこの値を ref へ書くだけ。

/**
 * @param {{ target: { x: number, y: number }, pose: { yaw: number, pitch: number } }} prev
 *   直前の向き状態（ロスト時の据え置き元）。
 * @param {import('./derive-face-signals').FaceSignals} s deriveFaceSignals の戻り。
 * @returns {{
 *   faceDetected: boolean,
 *   target: { x: number, y: number },
 *   pose: { yaw: number, pitch: number },
 *   roll: number, posX: number, posY: number,
 *   faceScale: number, mouth: number, eyesClosed: number,
 *   blendshapes: Array<{ categoryName: string, score: number }>,
 * }}
 */
export function nextFaceRefs(prev, s) {
  // 向きは検出時のみ更新、ロスト時は直前を維持。
  const target = s.faceDetected
    ? { x: s.x, y: s.y }
    : { x: prev.target.x, y: prev.target.y };
  const pose = s.faceDetected
    ? { yaw: s.yaw, pitch: s.pitch }
    : { yaw: prev.pose.yaw, pitch: prev.pose.pitch };

  return {
    faceDetected: s.faceDetected,
    target,
    pose,
    roll: s.roll,
    posX: s.posX,
    posY: s.posY,
    faceScale: s.faceScale,
    mouth: s.mouth,
    eyesClosed: s.eyesClosed,
    blendshapes: s.blendshapes,
  };
}
