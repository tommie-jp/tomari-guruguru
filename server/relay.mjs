// ぐるぐるアバター WS 中継サーバ（docs-camera/05）。
//
// 役割: producer(iPhone, ?role=tx) が送る「状態フレーム / config」を consumer(OBS の CEF,
// ?role=rx) へ素通しするだけ。信号の計算はしない。ただし最小限の接続管理は持ち、
//   - CEF 接続/再接続時: producer へ need-config（設定要求）+ peer 通知（接続表示用）
//   - producer 後発接続時: 既存 CEF があれば同じく need-config + peer を送る
// を仲介する（数秒ごとの再ブロードキャストはしない）。
//
// 起動:
//   node server/relay.mjs                      # ws://0.0.0.0:8787（LAN 平文）
//   RELAY_PORT=9000 node server/relay.mjs      # ポート変更
//   RELAY_CERT=cert.pem RELAY_KEY=key.pem \     # wss://（mkcert / tailscale cert を指定）
//     node server/relay.mjs
//
// 当面は認証なし（LAN 私設網に閉じる前提）。公開する場合は別途トークン等を足すこと。
import { WebSocketServer } from 'ws';
import { createServer } from 'node:https';
import { readFileSync } from 'node:fs';

const PORT = Number(process.env.RELAY_PORT) || 8787;
const CERT = process.env.RELAY_CERT;
const KEY = process.env.RELAY_KEY;

// TLS 証明書が指定されていれば wss、無ければ平文 ws。
let wss;
let scheme;
if (CERT && KEY) {
  const server = createServer({ cert: readFileSync(CERT), key: readFileSync(KEY) });
  wss = new WebSocketServer({ server });
  server.listen(PORT, '0.0.0.0');
  scheme = 'wss';
} else {
  wss = new WebSocketServer({ port: PORT, host: '0.0.0.0' });
  scheme = 'ws';
}

const producers = new Set(); // tx（iPhone）
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
console.log(`[relay] listening on ${scheme}://0.0.0.0:${PORT}  (tx=producer, rx=consumer)`);
