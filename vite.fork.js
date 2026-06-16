// フォーク固有の Vite 設定。本家 vite.config.js は素のまま保ち、ここを
// mergeConfig で合成する（vite.config.js 参照）。
//
// 集約しているもの:
//   - カメラ/トラッキング版のビルドエントリ（本家に無いページ）
//   - WSL 自動判定による server.host 既定（Windows 側 Chrome から到達可能に）
//   - VITE_HOST / VITE_NO_OPEN による明示上書き
//   - dev サーバのポート固定（strictPort）
//
// 新しいページを足すときは下の input に1行足すだけ。vite.config.js は触らない。
import { loadEnv } from 'vite';
import { resolve } from 'path';
import { readFileSync } from 'fs';

// WSL かどうかの判定。WSL では Windows 側ブラウザが WSL の eth0 IP 経由でしか
// 届かず、127.0.0.1 バインドだと到達できない。0.0.0.0 バインドが必須になる。
// ネイティブ Linux / mac は同一ホストの loopback で足りるので 127.0.0.1 のままでよい。
function isWSL() {
  if (process.env.WSL_DISTRO_NAME) return true;
  try {
    return /microsoft|wsl/i.test(readFileSync('/proc/version', 'utf8'));
  } catch {
    return false;
  }
}

export default function forkConfig({ command, mode }) {
  // WSL は自動判定して 0.0.0.0 バインドを既定にするため、通常 .env.local は不要。
  // 個人環境向けの明示上書き（git 管理外の .env.local）も引き続き最優先で効く:
  //   VITE_HOST=1    … 0.0.0.0 でリッスン（ヘッドレス/リモート閲覧などで明示したいとき）
  //   VITE_NO_OPEN=1 … 自動ブラウザオープンを無効化
  const env = loadEnv(mode, process.cwd(), '');

  const config = {
    // fork: GitHub Pages のリポジトリ名（guruguru-avatar）に追従させる base。
    // 本家 vite.config.js は upstream と字面一致を保ちたいので、リネームに伴う
    // base 上書きはこの fork 側に集約する（mergeConfig で fork が勝つ）。
    base: command === 'build' ? '/guruguru-avatar/' : '/',
    server: {
      port: 5173,
      strictPort: true,
      // npm run dev で開く既定ページ（本家の /talk.html を上書き）
      open: '/camera.html',
    },
    preview: {
      // npm run preview では常にカメラ版を開く（base /guruguru-avatar/ 込みの絶対パス）
      open: '/guruguru-avatar/camera.html',
    },
    build: {
      rollupOptions: {
        input: {
          camera: resolve(import.meta.dirname, 'camera.html'),
          tracking: resolve(import.meta.dirname, 'tracking.html'),
        },
      },
    },
  };

  // WSL なら既定で全インターフェイスにバインド（Windows Chrome から到達可能に）。
  // ネイティブ環境では host を設定せず、upstream の 127.0.0.1 をそのまま活かす。
  if (isWSL()) config.server.host = true;

  // 明示フラグは常に最優先（従来互換。WSL 判定や upstream 既定より勝つ）。
  if (env.VITE_HOST === '1') config.server.host = true;
  if (env.VITE_NO_OPEN === '1') config.server.open = false;

  return config;
}
