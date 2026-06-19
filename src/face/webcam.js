// Webカメラ接続ヘルパー — getUserMedia を <video> に繋ぐ／止めるだけの薄いラッパ。

const DEFAULT_CONSTRAINTS = {
  video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
  audio: false,
};

/**
 * カメラを起動して video 要素に流し込み、再生開始まで待つ。
 * @param {HTMLVideoElement} video
 * @param {MediaStreamConstraints} [constraints]
 * @returns {Promise<MediaStream>}
 */
export async function startWebcam(video, constraints = DEFAULT_CONSTRAINTS) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(
      'このブラウザ/接続ではカメラを利用できません（localhost か HTTPS で開いてください）。',
    );
  }
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  try {
    video.srcObject = stream;
    // メタデータが揃うのを待ってから再生（readyState を安定させる）。
    // once 指定でリスナを自動除去（同じ video への再起動でハンドラが残らない）。
    await new Promise((resolve) => {
      if (video.readyState >= 1) return resolve();
      video.addEventListener('loadedmetadata', () => resolve(), { once: true });
    });
    await video.play();
    return stream;
  } catch (err) {
    // 取得後（メタデータ待ち/再生）でこけたら、確保済み stream を解放してから投げ直す。
    // ここで止めないと呼び出し側の stream 変数に未代入のままトラックが残りリークする。
    stopWebcam(stream);
    throw err;
  }
}

/**
 * ストリームの全トラックを停止してカメラを解放する。
 * @param {MediaStream | null | undefined} stream
 */
export function stopWebcam(stream) {
  if (!stream) return;
  for (const track of stream.getTracks()) track.stop();
}
