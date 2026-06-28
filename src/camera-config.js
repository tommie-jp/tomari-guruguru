// カメラ選択まわりの純関数レジストリ（character-config.js と同じ立ち位置）。
// navigator/DOM 非依存・副作用なしで、enumerateDevices の結果を「引数」で受け取る。
// こうすることでカメラ実機なしで Vitest 単体テストできる（docs-camera/54-テスト.md 方針）。

// 既定の映像サイズ。webcam.js の DEFAULT_CONSTRAINTS と値を揃える（ズレ防止）。
const VIDEO_IDEAL = { width: { ideal: 640 }, height: { ideal: 480 } };

/**
 * ?camera=<ラベル|番号> を読む。?avatar= の parseAvatarParam と同型。
 * 未指定・空は null（＝保存値/既定に従う）。ここでは deviceId へ解決しない
 * （デバイス未列挙でも解析できるよう、文字列のまま返す）。
 * @param {string} [search] location.search 相当（先頭 ? は任意）
 * @returns {string|null}
 */
export function parseCameraParam(search = '') {
  try {
    const raw = new URLSearchParams(search).get('camera');
    if (raw == null) return null;
    const v = raw.trim();
    return v === '' ? null : v;
  } catch {
    return null;
  }
}

/**
 * 列挙済みデバイスとラベル/番号文字列から deviceId を決定的に解決する純関数。
 * 優先: 完全一致(大小無視) > 部分一致(大小無視)。複数一致は「ラベルが短い順 →
 * 昇順」で安定ソートして先頭（enumerateDevices の順序は不定なので明示ソートで決定化）。
 * 数字のみは「N 番目（0 始まり）」。未一致・空・未列挙は null（＝既定カメラに任せる）。
 * @param {Array<{deviceId: string, label: string}>} devices
 * @param {string|null} value ラベル部分文字列 or 番号
 * @returns {string|null}
 */
export function resolveCameraDevice(devices, value) {
  if (!Array.isArray(devices) || devices.length === 0) return null;
  if (value == null) return null;
  const v = String(value).trim();
  if (v === '') return null;

  // 番号指定（順序依存なのでワンショット手動用。OBS はラベル推奨）。
  if (/^\d+$/.test(v)) {
    const i = parseInt(v, 10);
    return devices[i] ? devices[i].deviceId : null;
  }

  const needle = v.toLowerCase();
  const labeled = devices.filter((d) => d && d.label);
  const exact = labeled.filter((d) => d.label.toLowerCase() === needle);
  const pool = exact.length
    ? exact
    : labeled.filter((d) => d.label.toLowerCase().includes(needle));
  if (pool.length === 0) return null;

  const sorted = [...pool].sort(
    // 'en' 固定で実行ロケールに依存しない決定的な並びにする。
    (a, b) => a.label.length - b.label.length || a.label.localeCompare(b.label, 'en'),
  );
  return sorted[0].deviceId;
}

/**
 * セレクタ表示用のラベル整形。ラベルがあればそれ、無ければ「カメラ N」。
 * @param {string} label
 * @param {number} index 0 始まり
 * @returns {string}
 */
export function formatCameraLabel(label, index) {
  return label || `カメラ ${index + 1}`;
}

/**
 * getUserMedia へ渡す制約を一から組む純関数。スプレッドマージに頼らず
 * width/height の ideal を必ず保持する。deviceId 指定時は exact、未指定時は
 * facingMode をヒントに（前面/背面）。
 * @param {string|null} deviceId
 * @param {'user'|'environment'} [facingMode]
 * @returns {MediaStreamConstraints}
 */
export function buildCameraConstraints(deviceId, facingMode = 'user') {
  const video = { ...VIDEO_IDEAL };
  if (deviceId) {
    video.deviceId = { exact: deviceId };
  } else {
    video.facingMode = facingMode;
  }
  return { video, audio: false };
}
