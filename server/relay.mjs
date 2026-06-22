// ぐるぐるアバター WS 中継サーバ（docs-camera/05・08）。
//
// 役割: producer(?role=tx) が送る「状態フレーム / config」を consumer(OBS の CEF,
// ?role=rx) へ素通しするだけ。信号の計算はしない。ただし最小限の接続管理は持ち、
//   - CEF 接続/再接続時: producer へ need-config（設定要求）+ peer 通知（接続表示用）
//   - producer 後発接続時: 既存 CEF があれば同じく need-config + peer を送る
// を仲介する（数秒ごとの再ブロードキャストはしない）。
//
// --web-root を渡すと、同じポートで静的ファイル（index.html / assets / mediapipe）も
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
// 【ローカル/私設網での実行を前提とする】このサーバは認証・Origin 検証・ルーム分離を持た
// ない。到達できる相手は誰でも他者のポーズ/設定フレームを盗聴でき、偽のフレームも注入できる
// （流れるのは映像/音声ではなく数値ポーズのみなので、影響は描画の偽装・盗聴・DoS に限られ、
// RCE ではない）。したがって運用は次のどちらかに限定する:
//   (1) 同一PC の loopback（既定の 127.0.0.1。docs-camera/08 手順A）
//   (2) Tailscale など ACL で閉じた私設網（docs-camera/08 手順B）
// 既定バインドが 127.0.0.1 なのは、同一PC 用かつ Windows でファイアウォール・プロンプトを
// 出さないため。別端末から繋ぐときだけ --host 0.0.0.0 を付ける（信頼できる私設網のみ）。
// 公開インターネットや不特定多数の LAN へは晒さないこと。晒す必要があるなら、トークン認証・
// ルーム ID・maxPayload 制限を実装してから行う（docs-camera/90-懸念事項.md 参照）。
import { WebSocketServer } from 'ws';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createStaticHandler } from './static.mjs';
import { attachRelay } from './relay-core.mjs';

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

// 中継ロジック本体（producer/consumer 管理・素通し）は relay-core.mjs に集約。
// Vite dev 同居プラグイン（vite-plugin-relay.mjs）も同じ core を使う。
attachRelay(wss);

// eslint-disable-next-line no-console
console.log(
  `[relay] listening on ${scheme}://${HOST}:${PORT}  (tx=producer, rx=consumer)`
  + (webRootAbs ? `\n[relay] serving static: ${webRootAbs}` : ''),
);
