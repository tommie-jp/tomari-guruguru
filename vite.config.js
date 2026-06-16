import { defineConfig, mergeConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import forkConfig from './vite.fork.js';

// ── 本家(upstream)の素の設定 ───────────────────────────────────────────────
// この関数の中身は本家 vite.config.js と同じ字面に保つ。本家がここを直しても
// 3-way マージがそのまま当たるようにするため、並べ替えや再整形をしない。
// フォーク固有の追加（カメラ/トラッキングのエントリ・WSL 向け server 設定）は
// vite.fork.js に集約し、下の mergeConfig で合成する。
const upstreamConfig = ({ command }) => ({
  base: command === 'build' ? '/tomari-guruguru/' : '/',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    open: '/talk.html',
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        guruguru: resolve(import.meta.dirname, 'guruguru.html'),
        talk: resolve(import.meta.dirname, 'talk.html'),
      },
    },
  },
});

export default defineConfig((env) =>
  mergeConfig(upstreamConfig(env), forkConfig(env)),
);
