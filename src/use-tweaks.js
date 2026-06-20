// Tweaks 値の localStorage 永続化ヘルパー（フォーク追加）。
//
// 本家 tweaks-panel.jsx（vendored scaffold）はこれらを持たない。永続化は
// フォーク固有の関心事なので、本家ファイルに混ぜずこの独立モジュールに置く。
// こうすると本家が scaffold を差し替えても、永続化ロジックは無傷で残る。
//
// tweaks-panel.jsx の useTweaks がこれらを import して使う。

// 現在ページ名（例: index.html）。ストレージキーと default-themes の
// ファイル名の両方で使う。パスが取れなければ index にフォールバック。
export function tweaksPageName() {
  const path = (typeof location !== 'undefined' && location.pathname) || '';
  return path.split('/').pop() || 'index';
}

// 永続化キー。ページごとにバケットを分け、同一オリジンの guruguru / talk /
// camera が localStorage を共有しても衝突しないようにする。明示キーを渡せば優先。
export function tweaksStorageKey(explicit) {
  if (explicit) return explicit;
  return `tomari-tweaks:${tweaksPageName()}`;
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

// 「実効デフォルト」。ビルトインの最初のテーマを hardcoded defaults にマージ
// したものを返す。ビルトインが空／不正なら defaults のコピー。初期化時の
// シードと resetTweaks の両方で使う。部分テーマでも未指定キーは defaults で
// 埋まる（前方互換）。オブジェクトのキー順＝挿入順なので「最初の項目」が効く。
export function effectiveDefaultsFrom(builtins, defaults) {
  const first = isPlainObject(builtins) ? Object.keys(builtins)[0] : undefined;
  return first ? mergeIntoDefaults(builtins[first], defaults) : { ...defaults };
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

// エンベロープ {app,version,presets} なら presets を、素のマップ {名前:値}
// ならそれ自身を返す。インポートとビルトイン読込の両方で形を揃える。
function unwrapPresetsEnvelope(data) {
  return isPlainObject(data) && isPlainObject(data.presets) ? data.presets : data;
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
  const presets = sanitizePresets(unwrapPresetsEnvelope(data));
  if (Object.keys(presets).length === 0) {
    throw new Error('テーマが1件も見つかりませんでした');
  }
  return presets;
}

// ── ビルトイン（配布デフォルト）テーマ ───────────────────────────────────────
// public/default-themes/<page>.json を「常に存在する基底レイヤー」として読む。
// 非永続: 毎回ここから読むので JSON を更新すれば全ユーザーに反映される。
// localStorage のユーザーテーマは上に重ね、同名はユーザー優先で上書きできる。

// パース済み JSON からビルトインプリセットを取り出す純関数。ページガード付き:
// エンベロープに page があり expectedKey と不一致なら取り違えとみなし {} を返す。
// page が無い／expectedKey 未指定ならガードは効かせない。
export function selectBuiltinPresets(data, expectedKey) {
  if (isPlainObject(data) && data.page && expectedKey && data.page !== expectedKey) {
    return {};
  }
  return sanitizePresets(unwrapPresetsEnvelope(data));
}

// 応答が JSON ではなく HTML（dev サーバーや SPA フォールバックの index.html）か。
// 存在しない .json でも 200 で index.html を返すホストがあり、その場合 res.ok は
// true のまま本文が HTML になる。Content-Type が HTML、または本文が '<' で始まれば
// 「配布テーマ未配置」とみなす。壊れた JSON（'<' で始まらない）は false のまま
// 本物の異常として扱い、呼び出し側で error ログに残す。
export function isHtmlFallback(contentType, text) {
  if (typeof contentType === 'string' && contentType.toLowerCase().includes('html')) {
    return true;
  }
  return /^\s*</.test(text || '');
}

// public/default-themes/<page>.json を取得してビルトインプリセットを返す。
// 404・ネットワーク不通・壊れた JSON・ページ不一致・HTML フォールバックは
// すべて {}（無害に無効化）。
export async function fetchBuiltinPresets(baseUrl, page, expectedKey) {
  const url = (baseUrl || '/') + 'default-themes/' + page + '.json';
  try {
    const res = await fetch(url);
    if (!res.ok) {
      // 404 等。配布テーマが無いだけならアプリは継続動作するが、なぜテーマが
      // 当たらないか調べられるよう必ずログに残す（黙って消さない）。
      console.warn(`[tweaks] 配布デフォルトテーマを読み込めません (HTTP ${res.status}): ${url}`);
      return {};
    }
    const text = await res.text();
    // dev サーバー（Vite）や SPA フォールバックのある静的ホストは、存在しない
    // .json でも 200 で index.html を返す。これは「未配置」であって異常ではない
    // ので、JSON.parse して error を出さず、HTML を検知して warn で無害に {}。
    if (isHtmlFallback(res.headers.get('content-type'), text)) {
      console.warn(`[tweaks] 配布デフォルトテーマは未配置です（HTML フォールバック応答）: ${url}`);
      return {};
    }
    return selectBuiltinPresets(JSON.parse(text), expectedKey);
  } catch (err) {
    // ネットワーク不通や JSON パース失敗など「読めない」ケース。原因を添えて出す。
    console.error(`[tweaks] 配布デフォルトテーマの読み込みに失敗しました: ${url}`, err);
    return {};
  }
}

// ── パネル位置（ドラッグ移動）の永続化 ───────────────────────────────────────
// DraggablePanel が掴んで動かした HUD パネルの位置を覚えておくためのレイヤー。
// Tweaks 値とは別キーにし、ページ（camera/talk/...）× パネル id 単位で保存する。
// 形は {left, top}（px, 画面左上基準）。読み書き不可（プライベートモード等）や
// 壊れた値は黙って無視し、既定位置にフォールバックする（アプリは継続動作）。

export function panelPosStorageKey(id, explicit) {
  return tweaksStorageKey(explicit) + ':panelpos:' + id;
}

// 保存値を {left, top} で返す。未保存・壊れ・読取不可は null（＝既定位置を使う合図）。
export function loadPanelPos(id, explicit) {
  try {
    const raw = window.localStorage.getItem(panelPosStorageKey(id, explicit));
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (isPlainObject(o) && Number.isFinite(o.left) && Number.isFinite(o.top)) {
      return { left: o.left, top: o.top };
    }
    return null;
  } catch {
    return null;
  }
}

export function savePanelPos(id, pos, explicit) {
  try {
    window.localStorage.setItem(
      panelPosStorageKey(id, explicit),
      JSON.stringify({ left: pos.left, top: pos.top }),
    );
  } catch {
    /* 容量超過やプライベートモードでは黙って諦める */
  }
}

export function clearPanelPos(id, explicit) {
  try {
    window.localStorage.removeItem(panelPosStorageKey(id, explicit));
  } catch {
    /* 読み書き不可でも無視（既定位置に戻るだけ） */
  }
}

// パネルが画面外へ出ないよう {left, top} を内側へ収める純関数（DOM 非依存・テスト容易）。
// 四辺に pad の余白を残す。パネルが画面より大きい場合も左上は pad に留め（負へ行かない）、
// 少なくとも左上隅が掴める状態を保証する。
export function clampPanelPos(pos, viewport, size, pad = 8) {
  const maxLeft = Math.max(pad, viewport.width - size.width - pad);
  const maxTop = Math.max(pad, viewport.height - size.height - pad);
  return {
    left: Math.min(maxLeft, Math.max(pad, pos.left)),
    top: Math.min(maxTop, Math.max(pad, pos.top)),
  };
}

// ── fork:sections ── 折りたたみセクションの開閉状態（{ ラベル: 開いているか }）。
// tweaks 値とは別キーに保存する。値に混ぜると mergeIntoDefaults で落ち、テーマ
// export を汚し、resetTweaks で消えてしまうため、UI クロームとして分離する。
export function sectionStateKey(explicit) {
  return tweaksStorageKey(explicit) + ':sections';
}

// 開閉マップを返す。未保存・壊れ・読取不可は {}。boolean 以外の値は捨てる。
export function loadSectionState(explicit) {
  try {
    const raw = window.localStorage.getItem(sectionStateKey(explicit));
    if (!raw) return {};
    const o = JSON.parse(raw);
    if (!isPlainObject(o)) return {};
    const out = {};
    for (const k of Object.keys(o)) {
      if (typeof o[k] === 'boolean') out[k] = o[k];
    }
    return out;
  } catch {
    return {};
  }
}

export function saveSectionState(map, explicit) {
  try {
    window.localStorage.setItem(sectionStateKey(explicit), JSON.stringify(map));
  } catch {
    /* 容量超過やプライベートモードでは黙って諦める（次回は既定の開閉に戻るだけ） */
  }
}

// テーマ・エクスポート JSON のファイル名。形式は
// guruguru-avatar-tweaks-YYYY-MM-DD-HHMM.json（HHMM=時分）。Date を引数で
// 受ける純関数にして決定的にテストできるようにする。値はローカル時刻で組む。
export function tweaksExportFilename(date) {
  const p2 = (n) => String(n).padStart(2, '0');
  const y = date.getFullYear();
  const mo = p2(date.getMonth() + 1);
  const d = p2(date.getDate());
  const hhmm = p2(date.getHours()) + p2(date.getMinutes());
  return `guruguru-avatar-tweaks-${y}-${mo}-${d}-${hhmm}.json`;
}
