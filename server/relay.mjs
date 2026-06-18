// ぐるぐるアバター WS 中継サーバ（docs-camera/05・08）。
//
// 役割: producer(?role=tx) が送る「状態フレーム / config」を consumer(OBS の CEF,
// ?role=rx) へ素通しするだけ。信号の計算はしない。ただし最小限の接続管理は持ち、
//   - CEF 接続/再接続時: producer へ need-config（設定要求）+ peer 通知（接続表示用）
//   - producer 後発接続時: 既存 CEF があれば同じく need-config + peer を送る
// を仲介する（数秒ごとの再ブロードキャストはしない）。
//
// --web-root を渡すと、同じポートで静的ファイル（camera.html / assets / mediapipe）も
// 配信する。単一 Windows PC で OBS 用の tx/rx を動かすとき、Vite を別途立てずに
// 「node server/relay.mjs --web-root dist-local」だけで完結させるための統合モード。
//
// 起動（CLI 引数 > 環境変数 > 既定 の優先順位）:
//   node server/relay.mjs                                  # ws://127.0.0.1:8787（WS のみ・loopback）
//   node server/relay.mjs --web-root dist-local            # 同ポートで HTTP+WS（OBS 単一PC用）
//   node server/relay.mjs --port 9000                      # ポート変更
//   node server/relay.mjs --host 0.0.0.0                   # LAN 公開（要ファイアウォール開放）
//   node server/relay.mjs --cert cert.pem --key key.pem    # wss/https（mkcert / tailscale cert）
//   RELAY_PORT=9000 node server/relay.mjs                  # 環境変数でも可（従来互換）
//
// 既定バインドは 127.0.0.1（同一PC・loopback）。Windows でファイアウォール・プロンプトを
// 出さないため。LAN の別端末（iPhone 等）から繋ぐときだけ --host 0.0.0.0 を付ける。
// 当面は認証なし（LAN 私設網に閉じる前提）。公開する場合は別途トークン等を足すこと。
import { WebSocketServer } from 'ws';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createStaticHandler } from './static.mjs';

// `--flag value` と `--flag=value` の両形式を拾う最小パーサ。
function parseArgs(argv) {
  const out = {};
  const keys = new Set(['port', 'host', 'cert', 'key', 'web-root']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq !== -1) {
      const k = a.slice(2, eq);
      if (keys.has(k)) out[k] = a.slice(eq + 1);
    } else {
      const k = a.slice(2);
      if (keys.has(k)) out[k] = argv[++i];
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

// 優先順位: CLI 引数 > 環境変数 > 既定。
const PORT = Number(args.port ?? process.env.RELAY_PORT) || 8787;
const HOST = args.host ?? process.env.RELAY_HOST ?? '127.0.0.1';
const CERT = args.cert ?? process.env.RELAY_CERT;
const KEY = args.key ?? process.env.RELAY_KEY;
const WEB_ROOT = args['web-root'] ?? process.env.RELAY_WEB_ROOT ?? null;

// --web-root が指定され、実在すれば静的配信する。無ければ WS 専用（HTTP は 404）。
let webRootAbs = null;
let staticHandler;
if (WEB_ROOT && existsSync(WEB_ROOT)) {
  webRootAbs = resolve(WEB_ROOT);
  staticHandler = createStaticHandler(webRootAbs);
} else {
  if (WEB_ROOT) {
    // eslint-disable-next-line no-console
    console.warn(`[relay] web-root が見つかりません: ${WEB_ROOT}（WS のみで起動）`);
  }
  staticHandler = (req, res) => {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('guruguru relay (WS only)');
  };
}

// TLS 証明書が指定されていれば https/wss、無ければ平文 http/ws。
// いずれも HTTP サーバを作り、その upgrade に WebSocketServer を相乗りさせる
// （1ポートで HTTP+WS）。
let server;
let scheme;
if (CERT && KEY) {
  server = createHttpsServer({ cert: readFileSync(CERT), key: readFileSync(KEY) }, staticHandler);
  scheme = 'wss';
} else {
  server = createHttpServer(staticHandler);
  scheme = 'ws';
}
const wss = new WebSocketServer({ server });
server.listen(PORT, HOST);

const producers = new Set(); // tx（送信側ブラウザ）
const consumers = new Set(); // rx（OBS の CEF）

function send(sock, obj) {
  if (sock.readyState === 1) sock.send(JSON.stringify(obj));
}

function broadcast(set, data) {
  for (const s of set) if (s.readyState === 1) s.send(data);
}

// CEF が居る producer に「設定を出して」+「いま CEF が n 台つながっている」を伝える。
function requestConfigAndNotify(target) {
  send(target, { type: 'need-config' });
  send(target, { type: 'peer', role: 'rx', event: 'connect', count: consumers.size });
}

function roleOf(req) {
  try {
    return new URL(req.url, 'http://localhost').searchParams.get('role');
  } catch {
    return null;
  }
}

wss.on('connection', (ws, req) => {
  const role = roleOf(req);

  if (role === 'rx') {
    consumers.add(ws);
    // 新しい CEF が来た → 全 producer に config を要求し、接続を通知。
    for (const p of producers) requestConfigAndNotify(p);
    ws.on('close', () => {
      consumers.delete(ws);
      for (const p of producers) {
        send(p, { type: 'peer', role: 'rx', event: 'disconnect', count: consumers.size });
      }
    });
    // consumer は受信専用。万一メッセージが来ても中継しない。
    return;
  }

  // 既定は producer（tx）。
  producers.add(ws);
  // producer が後から繋がったケース: 既に CEF が居れば取りこぼさないよう即要求＋通知。
  if (consumers.size > 0) requestConfigAndNotify(ws);
  // producer の state / config を全 consumer へ素通し。
  ws.on('message', (data, isBinary) => {
    broadcast(consumers, isBinary ? data : data.toString());
  });
  ws.on('close', () => producers.delete(ws));
});

// eslint-disable-next-line no-console
console.log(
  `[relay] listening on ${scheme}://${HOST}:${PORT}  (tx=producer, rx=consumer)`
  + (webRootAbs ? `\n[relay] serving static: ${webRootAbs}` : ''),
);
