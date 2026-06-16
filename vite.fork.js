// フォーク固有の Vite 設定。本家 vite.config.js は素のまま保ち、ここを
// mergeConfig で合成する（vite.config.js 参照）。
//
// 集約しているもの:
//   - カメラ/トラッキング版のビルドエントリ（本家に無いページ）
//   - WSL + Windows Chrome 向けの server 上書き（VITE_HOST / VITE_NO_OPEN）
//   - dev サーバのポート固定（strictPort）
//
// 新しいページを足すときは下の input に1行足すだけ。vite.config.js は触らない。
import { loadEnv } from 'vite';
import { resolve } from 'path';

export default function forkConfig({ command, mode }) {
  // 個人環境向けの上書きは .env.local（git 管理外）で行う:
  //   VITE_HOST=1    … 0.0.0.0 でリッスン（WSL の Windows 側 Chrome から到達可）
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

  // フラグが立っているときだけ本家の既定を上書きする（未設定なら upstream を尊重）。
  if (env.VITE_HOST === '1') config.server.host = true;
  if (env.VITE_NO_OPEN === '1') config.server.open = false;

  return config;
}
