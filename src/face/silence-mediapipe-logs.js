// MediaPipe(@mediapipe/tasks-vision)の WASM が console 経由で吐く glog 形式の
// 診断ログを抑制する。tasks-vision の JS API にはログレベル設定が無いため、
// console をラップして「既知の info/warning ノイズ」だけを間引く。
//
// 対象（落とす）:
//   - glog の info(I)/warning(W) 行
//       "W0615 08:32:29.6 ... face_landmarker_graph.cc:180] ..."
//       "I0615 08:32:29.6 ... gl_context.cc:407] GL version: 3.0 ..."
//   - 定型メッセージ "Graph successfully started running."
//   - TFLite ランタイムの定型 info
//       "INFO: Created TensorFlow Lite XNNPACK delegate for CPU."
// 残す（通す）:
//   - error(E)/fatal(F) 行などの本物の問題
//   - アプリ自身のログ全般

// glog 形式の info/warning 行（先頭が I か W）。E/F は意図的に対象外。
const GLOG_INFO_WARN = /^[IW]\d{4}\s+\d{2}:\d{2}:\d{2}/;

// glog 形式ではないが MediaPipe / TFLite が必ず出す定型メッセージ。
const NOISE_SUBSTRINGS = [
  'Graph successfully started running.',
  // TFLite XNNPACK の初期化 info（"... for CPU." 等、末尾は環境で変わるため前方一致）
  'Created TensorFlow Lite XNNPACK delegate',
];

/**
 * console メソッドに渡された引数が MediaPipe のノイズログかを判定する。
 * @param {unknown[]} args
 * @returns {boolean}
 */
export function isMediaPipeNoise(args) {
  const first = args[0];
  if (typeof first !== 'string') return false;
  if (GLOG_INFO_WARN.test(first)) return true;
  return NOISE_SUBSTRINGS.some((s) => first.includes(s));
}

let restore = null;

/**
 * console から MediaPipe のノイズログだけを間引く。
 * 多重呼び出しは無視し、最初に返した restore をそのまま返す（冪等）。
 * @param {Console} [target] テスト用に差し替え可能
 * @returns {() => void} 元の console に戻す関数
 */
export function silenceMediaPipeLogs(target = console) {
  if (restore) return restore;

  const methods = ['log', 'info', 'warn', 'error', 'debug'];
  const originals = {};
  for (const method of methods) {
    const original = target[method];
    if (typeof original !== 'function') continue;
    originals[method] = original;
    target[method] = (...args) => {
      if (isMediaPipeNoise(args)) return;
      original.apply(target, args);
    };
  }

  restore = () => {
    for (const method of Object.keys(originals)) {
      target[method] = originals[method];
    }
    restore = null;
  };
  return restore;
}
