// index.html を WS 中継のどの役割で動かすかを URL から決める純関数。
//   ?tx[=ws]        → producer（カメラ+推論し、状態フレームを送信。設定UIもここ）
//   ?rx[=ws]        → consumer（カメラを起動せず、受信した状態フレームで描画。OBS の CEF 用）
//   どちらも無し      → local（従来どおり単独で完結。送受信しない）
//   ?relay=<url>     → 中継サーバの WebSocket URL を明示上書き
//
// relay URL を省略したときは「ページと同一オリジン（同じ host:port）＋専用パス /__relay」を
// 既定にする。dev では Vite(5173) に中継を同居させ、配信では relay.mjs --web-root が同一ポートで
// HTTP+WS を配るので、どちらも「ページと同じところへ /__relay で繋ぐ」一つの規則で一致する。
// 別ホスト/別ポートの中継（Tailscale の別マシン等）は ?relay= で完全な URL を明示する。
// ページが https なら wss、http なら ws を選ぶ（mixed-content 回避）。
// 役割の判定は ?obs とは独立。表示側では rx を OBS の CEF 用とみなし、
// obs 未指定でも透過オーバーレイを既定 ON にする（obs-mode.js / camera-app.jsx 参照）。

const TRUTHY = new Set(['', '1', 'true', 'yes', 'on', 'ws']);

function flag(params, name) {
  if (!params.has(name)) return false;
  return TRUTHY.has((params.get(name) || '').toLowerCase());
}

// 中継 WS の専用パス。Vite dev に同居させた relay を HMR の WS（subprotocol 'vite-hmr'）と
// 区別する振り分けキー。standalone の server/relay.mjs は roleOf がクエリ(?role)だけ見るので
// パス非依存に受理する（/__relay でも / でも同じ）。vite-plugin-relay もこの定数を共有する。
export const RELAY_PATH = '/__relay';

/**
 * 既定の中継 URL を組み立てる。SSR/テスト用に location 相当を引数で受ける。
 * 同一オリジン（ページと同じ host=hostname:port）＋専用パス /__relay を返す。
 * @param {{ protocol?: string, host?: string, hostname?: string }} [loc]
 * @returns {string}
 */
export function defaultRelayUrl(loc = {}) {
  const secure = loc.protocol === 'https:';
  const scheme = secure ? 'wss' : 'ws';
  // host（hostname:port）優先。SSR/テストで host が無ければ hostname、それも無ければ localhost。
  const host = loc.host || loc.hostname || 'localhost';
  return `${scheme}://${host}${RELAY_PATH}`;
}

/**
 * @param {string} [search] location.search 相当（先頭 ? は任意）
 * @param {{ protocol?: string, hostname?: string }} [loc] location 相当
 * @returns {{ mode: 'local'|'tx'|'rx', relayUrl: string }}
 */
export function parseRelayMode(search = '', loc = {}) {
  const params = new URLSearchParams(search);
  const tx = flag(params, 'tx');
  const rx = flag(params, 'rx');
  // tx と rx が同時指定されたら tx を優先（送信側が主）。
  const mode = tx ? 'tx' : rx ? 'rx' : 'local';
  const relayUrl = params.get('relay') || defaultRelayUrl(loc);
  return { mode, relayUrl };
}
