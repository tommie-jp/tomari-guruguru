// Vite dev / preview サーバに WS 中継（server/relay-core.mjs）を同居させるプラグイン。
//
// ねらい: 開発でも配信(relay.mjs --web-root)と同じく「1 プロセス・同一オリジン」で動かす。
// `npm run dev` だけで Vite の HMR と中継 WS が同じポートに同居し、別途 relay.mjs を立てなくてよい。
// （別マシン/別ポートの中継が要る構成は従来どおり ?relay= で明示し、standalone relay.mjs を使う）。
//
// 仕組み:
//   - WebSocketServer({ noServer:true }) を作り、Vite の server.httpServer の 'upgrade' に相乗りする。
//   - パスが RELAY_PATH(/__relay) の upgrade だけを handleUpgrade で捌く。それ以外（HMR の
//     'vite-hmr' subprotocol 等）は socket に一切触れず return → Vite 側リスナがそのまま処理する。
//     Vite 8 は HMR upgrade を「subprotocol が vite-hmr/vite-ping かつ pathname===hmrBase」で識別し、
//     不一致は早期 return（socket 不可侵）なので /__relay とは衝突しない（vite ソースで確認済み）。
//
// セキュリティ（重要）:
//   standalone の relay.mjs は既定 127.0.0.1 で「無認証 WS は loopback のみ」を守っている。
//   一方この同居は Vite の server.host を継承するため、WSL や VITE_HOST=1 では 0.0.0.0 になり、
//   無認証で読み書きできる中継 WS が LAN へ露出しうる（流れるのは数値 pose のみで RCE は無いが、
//   偽フレーム注入＝配信画面の改ざんや盗聴は可能）。そこで既定では upgrade の remoteAddress を
//   loopback に限定して中継を拒否し、LAN 公開は expose（RELAY_EXPOSE=1）でのみオプトインする。
//   公開時は起動ログで「無認証・LAN 露出」を警告する。

import { WebSocketServer } from 'ws';
import { attachRelay } from './server/relay-core.mjs';
import { RELAY_PATH } from './src/relay-mode.js';

// 127.0.0.0/8 と ::1 / ::ffff:127.x を loopback とみなす。remoteAddress 不明は安全側で非 loopback 扱い。
// セキュリティの要なので named export して vite-plugin-relay.test.js で表駆動テストする。
export function isLoopback(addr) {
  if (!addr) return false;
  if (addr === '::1') return true;
  const v4 = addr.startsWith('::ffff:') ? addr.slice(7) : addr;
  return v4 === '127.0.0.1' || v4.startsWith('127.');
}

// dev / preview いずれの ViteDevServer/PreviewServer にも同じ配線を当てる。
// upgrade 振り分け（/__relay 以外は不可侵 / 非loopback は destroy / handleUpgrade）の検証用に named export。
export function wireRelay(server, { expose, kind }) {
  const httpServer = server.httpServer;
  // 通常起動（非 middlewareMode）では httpServer は非 null。念のためガード。
  if (!httpServer) return;

  const wss = new WebSocketServer({ noServer: true });
  attachRelay(wss); // 中継ロジックは standalone relay.mjs と共有

  httpServer.on('upgrade', (req, socket, head) => {
    // クエリ付き(/__relay?role=tx)でも安全に判定するため pathname で比較。
    let pathname;
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch {
      return;
    }
    // ★ 自分の担当（/__relay）以外には絶対に触れない（socket.destroy も呼ばない）。
    //   触ると HMR の upgrade を奪って HMR が全断する。
    if (pathname !== RELAY_PATH) return;

    // 既定は loopback 限定。LAN 露出は expose のときだけ許可（無認証 WS を生で晒さない）。
    // socket === req.socket（同一オブジェクト）。関数内の参照を socket に一本化する。
    if (!expose && !isLoopback(socket.remoteAddress)) {
      socket.destroy(); // ここは /__relay 確定後＝自分の担当なので破棄してよい
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  // eslint-disable-next-line no-console
  console.log(
    `[relay] embedded in vite ${kind} at ${RELAY_PATH}  `
    + (expose
      ? '(⚠ RELAY_EXPOSE=1: 無認証WSをLANへ公開中。信頼できる私設網のみで使うこと)'
      : '(loopback のみ。LAN公開は RELAY_EXPOSE=1)'),
  );
}

/**
 * @param {{ expose?: boolean }} [opts] expose=true で LAN 公開（RELAY_EXPOSE=1 相当）
 * @returns {import('vite').Plugin}
 */
export default function relayWsPlugin(opts = {}) {
  const expose = !!opts.expose;
  return {
    name: 'guruguru-relay-ws',
    apply: 'serve', // dev / preview のみ（build には不要）
    configureServer(server) {
      wireRelay(server, { expose, kind: 'dev' });
    },
    configurePreviewServer(server) {
      // preview には Vite の HMR WS が無いので競合相手すら居ない。配信版に近い形で中継も同居。
      wireRelay(server, { expose, kind: 'preview' });
    },
  };
}
