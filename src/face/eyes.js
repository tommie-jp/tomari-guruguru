// 目の閉じ具合を取り出す純関数（副作用なし・テスト容易）。
// MediaPipe FaceLandmarker の eyeBlinkLeft / eyeBlinkRight（0:開き..1:閉じ）の
// 平均を返す。まばたき同調の主信号。

/**
 * @param {Array<{categoryName: string, score: number}>|undefined} categories
 * @returns {number} 0(両目開き)..1(両目閉じ)
 */
export function eyesClosedFromBlendshapes(categories) {
  if (!categories) return 0;
  let left = 0;
  let right = 0;
  for (const c of categories) {
    if (c.categoryName === 'eyeBlinkLeft') left = c.score;
    else if (c.categoryName === 'eyeBlinkRight') right = c.score;
  }
  return (left + right) / 2;
}
