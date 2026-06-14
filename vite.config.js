import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig(({ command, mode }) => {
  // 個人環境向けの上書きは .env.local（git 管理外）で行う:
  //   VITE_HOST=1    … 0.0.0.0 でリッスン（WSL の Windows 側 Chrome から localhost で到達できるようにする）
  //   VITE_NO_OPEN=1 … 自動ブラウザオープンを無効化（WSL では Windows の Chrome を起動できないため）
  const env = loadEnv(mode, process.cwd(), '');

  return {
    base: command === 'build' ? '/tomari-guruguru/' : '/',
    plugins: [react()],
    server: {
      host: env.VITE_HOST === '1' ? true : '127.0.0.1',
      port: 5173,
      strictPort: true,
      open: env.VITE_NO_OPEN === '1' ? false : '/talk.html',
    },
    build: {
      rollupOptions: {
        input: {
          main: resolve(import.meta.dirname, 'index.html'),
          guruguru: resolve(import.meta.dirname, 'guruguru.html'),
          talk: resolve(import.meta.dirname, 'talk.html'),
          camera: resolve(import.meta.dirname, 'camera.html'),
        },
      },
    },
  };
});
