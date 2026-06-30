// Electron main プロセスに内蔵する HTTP + WS(中継) サーバ。
//
// ねらい: standalone の server/relay.mjs と同じ中継挙動を、Electron アプリ内の 1 プロセスで
//   提供する。配信ロジック（static.mjs）と中継ロジック（relay-core.mjs）は共有し、
//   ここは「http サーバを立てて /__relay の upgrade だけ中継へ渡す」配線に徹する。
//
// 設計:
//   - electron に一切依存しない（main.mjs から webRoot を渡してもらう）。これにより
//     electron 抜きで Vitest から headless にテストできる（embedded-server.test.mjs）。
//   - bind は 127.0.0.1 固定＝ループバックのみ。無認証 WS を LAN へ晒さない（リモートは
//     loopback バインドのソケットに到達できない）。LAN/wss 公開は後続フェーズで明示的に行う。
//   - 既定ポートが埋まっていたら ephemeral(0) にフォールバックして必ず起動する。
import { createServer as createHttpServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { createStaticHandler } from '../server/static.mjs';
import { attachRelay } from '../server/relay-core.mjs';
import { RELAY_PATH } from '../src/relay-mode.js';

/**
 * 内蔵サーバを起動する。
 * @param {{ webRoot: string, host?: string, port?: number }} opts
 *   webRoot: 配信ルート（dist-local）。host 既定 127.0.0.1。port 既定 0（ephemeral）。
 * @returns {Promise<{ server: import('node:http').Server, wss: import('ws').WebSocketServer, host: string, port: number }>}
 */
export function createEmbeddedServer({ webRoot, host = '127.0.0.1', port = 0 }) {
  return new Promise((resolve, reject) => {
    const serve = createStaticHandler(webRoot); // パストラバーサル対策済みの (req,res) ハンドラ
    const server = createHttpServer(serve);
    const wss = new WebSocketServer({ noServer: true });
    attachRelay(wss); // 中継ロジックは relay.mjs / vite-plugin と共有（DRY）

    // /__relay の upgrade だけ中継へ。それ以外の upgrade は破棄（他にリスナは居ない）。
    server.on('upgrade', (req, socket, head) => {
      let pathname;
      try {
        pathname = new URL(req.url, 'http://localhost').pathname;
      } catch {
        socket.destroy();
        return;
      }
      if (pathname !== RELAY_PATH) {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    });

    // 既定ポート使用中なら 0（ephemeral）で再試行。それ以外のエラーは reject。
    const onErr = (e) => {
      if (e && e.code === 'EADDRINUSE' && port !== 0) {
        server.removeListener('error', onErr);
        server.listen(0, host, () => {
          resolve({ server, wss, host, port: server.address().port });
        });
        return;
      }
      reject(e);
    };
    server.once('error', onErr);
    server.listen(port, host, () => {
      server.removeListener('error', onErr);
      resolve({ server, wss, host, port: server.address().port });
    });
  });
}
