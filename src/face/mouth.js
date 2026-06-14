// 口の開き具合を取り出す純関数（副作用なし・テスト容易）。
// MediaPipe FaceLandmarker の faceBlendshapes[].categories から jawOpen を採用する。
// jawOpen は 0(閉じ)..1(全開) のスコア。口パクの主信号として十分。

/**
 * @param {Array<{categoryName: string, score: number}>|undefined} categories
 * @returns {number} 0..1 の口の開き量
 */
export function mouthOpenFromBlendshapes(categories) {
  if (!categories) return 0;
  for (const c of categories) {
    if (c.categoryName === 'jawOpen') return c.score;
  }
  return 0;
}
