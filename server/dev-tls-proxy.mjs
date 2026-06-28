// dev-tls-proxy.mjs — dev 用の TLS リバースプロキシ（doStartDev.sh の既定 --both モード専用）。
//
// ねらい: localhost(http) と tailscale(https) を「1回の起動」で同時に使えるようにする。
//   vite dev は 1 プロセス＝1 プロトコルなので、同じポートで http と https を同時には喋れない。
//   そこで vite は http のまま（WSL では 0.0.0.0:5173＝Windows Chrome から localhost で届く）、
//   このプロキシを tailscale IP の別ポート(既定 5174)に立てて TLS 終端し、平文で
//   127.0.0.1:5173（vite）へ素通しする。
//     PC      → http://localhost:5173            (vite 直結 / HMR が効く)
//     iPhone  → https://<fqdn>:5174/index.html?tx (proxy → vite。Safari の secure context を満たす)
//     OBS     → https://<fqdn>:5174/index.html?rx
//   （vite が 0.0.0.0:5173 を掴む＝tailscale IP:5173 も占有するため、proxy は別ポートにする）。
//
// IPv6: tailscale は v4(100.x) と v6(fd7a:...) の両方を持ち、iPhone が v6 を選ぶことがある。
//   両方に bind できるよう BIND_IPS にカンマ区切りで複数アドレスを渡せる。片方が bind 失敗しても
//   もう片方が生きていれば継続する（全滅したときだけ exit 1）。
//
// セキュリティ: プロキシは vite の中継(/__relay)へ 127.0.0.1 から繋ぐので、中継は loopback 判定で
//   常に受理される＝ RELAY_EXPOSE 不要。tailnet からは TLS 終端したこのプロキシ経由でのみ届く。
//   無認証 WS であることは従来どおりなので、ACL で閉じた私設網（tailscale）でのみ使うこと。
//
// 依存ゼロ: http-proxy / node-http-proxy などの npm パッケージは使わず、Node コアのみで実装する
//   （https=TLS 終端 / http.request=HTTP 転送 / net.connect+pipe=WebSocket トンネル）。透過転送に
//   徹するので、これで HMR(/) と中継(/__relay) の両方の upgrade を区別なく中継できる。
//
// 設定（環境変数）:
//   CERT         TLS 証明書（.crt/.pem）パス（必須）
//   KEY          TLS 秘密鍵（.key）パス（必須）
//   BIND_IPS     待ち受け IP（カンマ区切り。例 "100.97.217.81,fd7a:115c:a1e0::5001:d9b8"）
//   BIND_IP      BIND_IPS が無いときの単一フォールバック
//   LISTEN_PORT  待ち受けポート（既定 5174）
//   TARGET_HOST  転送先ホスト（既定 127.0.0.1）
//   TARGET_PORT  転送先ポート（既定 5173）

import { createServer as createHttpsServer } from 'node:https';
import { request as httpRequest } from 'node:http';
import { connect as netConnect } from 'node:net';
import { readFileSync, existsSync } from 'node:fs';

const CERT = process.env.CERT;
const KEY = process.env.KEY;
const BIND_IPS = (process.env.BIND_IPS || process.env.BIND_IP || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const LISTEN_PORT = Number(process.env.LISTEN_PORT) || 5174;
const TARGET_HOST = process.env.TARGET_HOST || '127.0.0.1';
const TARGET_PORT = Number(process.env.TARGET_PORT) || 5173;

const log = (...a) => console.log('[tls-proxy]', ...a);
const err = (...a) => console.error('[tls-proxy]', ...a);
// v6 アドレスは URL 表記で角括弧に包む（ログ用）。
const fmtAddr = (ip) => (ip.includes(':') ? `[${ip}]` : ip);

// 必須項目の検証。足りなければ即終了（dev は呼び出し側 doStartDev.sh が http へフォールバックする）。
if (!CERT || !KEY) {
  err('CERT と KEY は必須です（env で渡す）'); process.exit(1);
}
if (!BIND_IPS.length) {
  err('BIND_IPS（または BIND_IP）は必須です（tailscale self IP を渡す）'); process.exit(1);
}
if (!existsSync(CERT) || !existsSync(KEY)) {
  err(`証明書が見つかりません: ${!existsSync(CERT) ? CERT : KEY}`);
  err('  tailscale cert で発行し、自分の所有にしておくこと:');
  err('  sudo tailscale cert <fqdn> && sudo chown "$USER" <fqdn>.crt <fqdn>.key');
  process.exit(1);
}

let tlsOptions;
try {
  tlsOptions = { cert: readFileSync(CERT), key: readFileSync(KEY) };
} catch (e) {
  err(`証明書を読めません（権限を確認）: ${e.message}`);
  err('  鍵が root 所有なら: sudo chown "$USER" <fqdn>.crt <fqdn>.key');
  process.exit(1);
}

// ── 通常の HTTP リクエスト転送 ────────────────────────────────────────────
// Host はそのまま保持（vite の allowedHosts 判定・中継のパス解決に必要）。X-Forwarded-* を付与。
function requestHandler(creq, cres) {
  const headers = {
    ...creq.headers,
    'x-forwarded-proto': 'https',
    'x-forwarded-for': creq.socket.remoteAddress,
  };
  const preq = httpRequest(
    { host: TARGET_HOST, port: TARGET_PORT, method: creq.method, path: creq.url, headers },
    (pres) => {
      cres.writeHead(pres.statusCode, pres.headers);
      pres.pipe(cres);
    },
  );
  preq.on('error', (e) => {
    if (e.code === 'ECONNREFUSED') err(`upstream に繋がりません ${TARGET_HOST}:${TARGET_PORT}（vite は起動済み?）`);
    else err('upstream エラー:', e.message);
    if (!cres.headersSent) cres.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    cres.end('Bad Gateway (tls-proxy)');
  });
  creq.pipe(preq);
}

// ── WebSocket / upgrade 透過トンネル ───────────────────────────────────────
// HMR(/) も中継(/__relay) も区別せず、生のリクエスト行＋ヘッダ＋先読みバッファ(head)を再送して
// 双方向に pipe する。Sec-WebSocket-* / Upgrade / Connection は一切いじらない。
function upgradeHandler(creq, csock, head) {
  const upstream = netConnect({ host: TARGET_HOST, port: TARGET_PORT }, () => {
    // rawHeaders は [k0,v0,k1,v1,...]。元のヘッダ（Host 含む）を忠実に再構築する。
    let block = `${creq.method} ${creq.url} HTTP/1.1\r\n`;
    for (let i = 0; i < creq.rawHeaders.length; i += 2) {
      block += `${creq.rawHeaders[i]}: ${creq.rawHeaders[i + 1]}\r\n`;
    }
    block += '\r\n';
    upstream.write(block);
    if (head && head.length) upstream.write(head);
    csock.pipe(upstream);
    upstream.pipe(csock);
  });
  upstream.on('error', (e) => {
    if (e.code === 'ECONNREFUSED') err('upgrade トンネル失敗: upstream 未起動（vite は起動済み?）');
    else err('upgrade トンネルエラー:', e.message);
    csock.destroy();
  });
  // どちらかが閉じたら相手も畳む（孤児ソケット防止）。
  csock.on('error', () => upstream.destroy());
  csock.on('close', () => upstream.destroy());
  upstream.on('close', () => csock.destroy());
}

// ── 各バインドアドレスごとに https サーバを立てる（同じハンドラを共有）──────────
const servers = [];
let settled = 0;
let bound = 0;
const onSettled = () => {
  // 全アドレスが出揃って、どれも bind できなければ終了（呼び出し側が http へフォールバック）。
  if (settled === BIND_IPS.length && bound === 0) {
    err('全アドレスで bind に失敗しました');
    process.exit(1);
  }
};

for (const ip of BIND_IPS) {
  const server = createHttpsServer(tlsOptions, requestHandler);
  server.on('upgrade', upgradeHandler);
  let isBound = false;
  server.on('error', (e) => {
    if (!isBound) {
      // listen 前のエラー＝bind 失敗。片方だけ失敗しても他方は生かす。
      if (e.code === 'EADDRNOTAVAIL') err(`${fmtAddr(ip)} にバインドできません（tailscale は起動中? / そのアドレスが無い）`);
      else if (e.code === 'EADDRINUSE') err(`${fmtAddr(ip)}:${LISTEN_PORT} は使用中です`);
      else err(`${fmtAddr(ip)} bind エラー:`, e.code || e.message);
      settled += 1;
      onSettled();
    } else {
      err(`${fmtAddr(ip)} ランタイムエラー:`, e.message);
    }
  });
  server.listen(LISTEN_PORT, ip, () => {
    isBound = true;
    bound += 1;
    settled += 1;
    log(`listening https://${fmtAddr(ip)}:${LISTEN_PORT} -> http://${TARGET_HOST}:${TARGET_PORT}`);
    if (bound === 1) {
      log(`TLS 証明書: ${CERT}`);
      log('転送: HTTP リクエスト + WebSocket upgrade（HMR=/ と 中継=/__relay の両方）');
    }
  });
  servers.push(server);
}

// ── シグナルで穏当に終了（doStartDev.sh の trap から kill される）─────────────
const shutdown = () => {
  let remaining = servers.length;
  if (remaining === 0) process.exit(0);
  for (const s of servers) s.close(() => { if (--remaining === 0) process.exit(0); });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
