// Tweaks 値の localStorage 永続化ヘルパー（フォーク追加）。
//
// 本家 tweaks-panel.jsx（vendored scaffold）はこれらを持たない。永続化は
// フォーク固有の関心事なので、本家ファイルに混ぜずこの独立モジュールに置く。
// こうすると本家が scaffold を差し替えても、永続化ロジックは無傷で残る。
//
// tweaks-panel.jsx の useTweaks がこれらを import して使う。

// 永続化キー。ページごとにバケットを分け、同一オリジンの guruguru / talk /
// camera が localStorage を共有しても衝突しないようにする。明示キーを渡せば優先。
export function tweaksStorageKey(explicit) {
  if (explicit) return explicit;
  const path = (typeof location !== 'undefined' && location.pathname) || '';
  const page = path.split('/').pop() || 'index';
  return `tomari-tweaks:${page}`;
}

// 配列・null を除いたプレーンなオブジェクトか。プリセット検証の土台。
function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

// saved を defaults に上書きマージして新しいオブジェクトを返す。defaults に
// 無いキーは捨てる（前方互換: 後から tweak 項目が増えても古い保存値で壊れない）。
// saved がオブジェクトでなければ defaults のコピーをそのまま返す。
export function mergeIntoDefaults(saved, defaults) {
  const merged = { ...defaults };
  if (isPlainObject(saved)) {
    for (const k of Object.keys(defaults)) {
      if (k in saved) merged[k] = saved[k];
    }
  }
  return merged;
}

// 保存値を defaults に上書きマージして返す。defaults に無いキーは捨て、
// 読み取り不可（プライベートモード等）や壊れた JSON なら defaults を使う。
export function loadTweaks(key, defaults) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return defaults;
    return mergeIntoDefaults(JSON.parse(raw), defaults);
  } catch {
    return defaults;
  }
}

export function saveTweaks(key, values) {
  try {
    window.localStorage.setItem(key, JSON.stringify(values));
  } catch {
    /* 容量超過やプライベートモードでは黙って諦める（アプリは継続動作） */
  }
}

// ── テーマ（名前付きプリセット）─────────────────────────────────────────────
// 現在値（上の tomari-tweaks:<page>）とは別キーに、名前付きスナップショットの
// マップ {名前: 値} を保存する。混ぜると「保存したら現在値が消えた」事故が
// 起きるため分離する。エクスポート/インポートで端末間の持ち運びにも対応。

export const PRESETS_EXPORT_VERSION = 1;

// 現在値キーに :presets を足したプリセット集のキー。ページ単位で分かれる。
export function presetsStorageKey(explicit) {
  return tweaksStorageKey(explicit) + ':presets';
}

// プリセット集を {名前: プレーンオブジェクト} だけに正規化する。空名や
// オブジェクトでない値は捨て、壊れた入力でも安全なマップを返す。
export function sanitizePresets(obj) {
  if (!isPlainObject(obj)) return {};
  const out = {};
  for (const [name, val] of Object.entries(obj)) {
    if (name && isPlainObject(val)) out[name] = val;
  }
  return out;
}

export function loadPresets(key) {
  try {
    return sanitizePresets(JSON.parse(window.localStorage.getItem(key) || 'null'));
  } catch {
    return {};
  }
}

export function savePresets(key, presets) {
  try {
    window.localStorage.setItem(key, JSON.stringify(presets));
  } catch {
    /* 容量超過やプライベートモードでは黙って諦める（アプリは継続動作） */
  }
}

// エクスポート用 JSON 文字列。app/version のエンベロープを付け、別アプリの
// JSON を取り違えてインポートしても弾けるようにする。読みやすく整形して返す。
export function serializePresets(presets, page) {
  return JSON.stringify({
    app: 'tomari-tweaks',
    version: PRESETS_EXPORT_VERSION,
    page: page || null,
    presets: sanitizePresets(presets),
  }, null, 2);
}

// インポート文字列を検証してプリセットマップを返す。エンベロープ形式
// （{app,version,presets}）と素のマップ（{名前:値}）の両方を受ける。JSON
// として読めない／有効なテーマが1件も無ければ例外を投げる（呼び出し側で握る）。
export function parsePresetsImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('JSON として読み込めませんでした');
  }
  const raw = isPlainObject(data) && isPlainObject(data.presets) ? data.presets : data;
  const presets = sanitizePresets(raw);
  if (Object.keys(presets).length === 0) {
    throw new Error('テーマが1件も見つかりませんでした');
  }
  return presets;
}
