// 中継サーバに相乗りさせる最小の静的ファイル配信ハンドラ。
//
// 単一 Windows PC で OBS 用 tx/rx ブラウザを動かすときに、Vite を別プロセスで
// 立てずに「camera.html / assets / mediapipe」を中継サーバと同じポートから配る。
// SPA ルーティングや圧縮などは持たない素朴な実装でよい（ローカル配信専用）。
//
// セキュリティ: ローカル loopback 前提だが、パストラバーサルだけは塞ぐ
// （root の外へ出る相対パスは 403）。
import { createReadStream, statSync } from 'node:fs';
import { resolve, normalize, join, relative, isAbsolute, extname } from 'node:path';

// 配信で必要になる拡張子のみ最小マップ。未知の拡張子は octet-stream で返す。
// .wasm は MediaPipe のローダが Content-Type を見るため必須。.task はモデル本体。
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.wav': 'audio/wav',
};

const mimeFor = (file) => MIME[extname(file).toLowerCase()] || 'application/octet-stream';

/**
 * root 配下を配信する (req, res) ハンドラを返す。
 * ルート("/")は index.html に寄せる（このアプリの入口＝カメラ版2/Pixi・複数アバター）。
 * @param {string} root 配信ルート（例: dist-local）
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void}
 */
export function createStaticHandler(root) {
  const rootAbs = resolve(root);
  return function serve(req, res) {
    // クエリを除いた pathname を取り出す。/ は index.html に寄せる。
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bad Request');
      return;
    }
    if (pathname === '/') pathname = '/index.html';

    // root の外へ出る相対パス（../ など）は拒否する。
    const filePath = normalize(join(rootAbs, pathname));
    const rel = relative(rootAbs, filePath);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    let st;
    try {
      st = statSync(filePath);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    if (st.isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }

    res.writeHead(200, { 'Content-Type': mimeFor(filePath), 'Content-Length': st.size });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const stream = createReadStream(filePath);
    stream.on('error', () => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
    stream.pipe(res);
  };
}
