// Electron main プロセス。中継内蔵サーバを起動し、BrowserWindow で既存 ?tx ページを開く。
//
// 構成（このフェーズ）:
//   - phone=tx / PC=rx の「PC 側」を 1 つの配布物にする。窓 = 既存 index.html?tx
//     （PCカメラ＋QR＋UI）。アプリ内の「カメラ源トグル」で PCカメラ / スマホ を切替える。
//   - 同一機 OBS は http://127.0.0.1:PORT/index.html?rx&obs（透過）を見て描画する。
//   - 中継は 127.0.0.1 ループバック限定（wss/LAN 公開は後続フェーズ）。
//
// ESM main は Electron 28+（本 repo は type:module）。secure context にするため file:// では
// なく内蔵 HTTP サーバの http://127.0.0.1 を loadURL する（dist-local は base=/ の絶対パス資産）。
import { app, BrowserWindow, session, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEmbeddedServer } from './embedded-server.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.join(__dirname, '..');
const HOST = '127.0.0.1';
const PREFERRED_PORT = 5179; // vite=5173 / standalone relay=8787 と重複しない既定

// パッケージ後は resources/dist-local、dev は repo の dist-local を配信。
const WEB_ROOT = app.isPackaged
  ? path.join(process.resourcesPath, 'dist-local')
  : path.join(APP_ROOT, 'dist-local');

let mainWindow = null;
/** @type {{ server: import('node:http').Server, port: number } | null} */
let embedded = null;

const appOrigin = () => `http://${HOST}:${embedded?.port}`;

// getUserMedia を内蔵サーバの自オリジンにだけ許可する（既定では Electron は media を拒否）。
function setupPermissions() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    let reqOrigin = '';
    try {
      reqOrigin = new URL(details?.requestingUrl ?? wc.getURL()).origin;
    } catch { /* noop */ }
    callback(permission === 'media' && reqOrigin === appOrigin());
  });
  ses.setPermissionCheckHandler((wc, permission, requestingOrigin) => {
    let origin = requestingOrigin;
    if (!origin && wc) {
      try { origin = new URL(wc.getURL()).origin; } catch { /* noop */ }
    }
    return permission === 'media' && origin === appOrigin();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: `Guruguru Avatar — :${embedded.port}`,
    backgroundColor: '#EEF4FB',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // 自オリジン外への遷移・新規ウィンドウは外部ブラウザへ逃がす（埋め込みアプリを固定）。
  mainWindow.webContents.on('will-navigate', (e, url) => {
    try {
      if (new URL(url).origin !== appOrigin()) {
        e.preventDefault();
        shell.openExternal(url);
      }
    } catch {
      e.preventDefault();
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // 窓 = 既存 ?tx ページ（既定 PCカメラ）。カメラ源トグルは app 内で pc/phone を切替える。
  mainWindow.loadURL(`${appOrigin()}/index.html?tx`);
  mainWindow.on('closed', () => { mainWindow = null; });
}

// 単一インスタンスロック（2 個目起動で内蔵サーバのポート二重 bind を防ぐ）。
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    embedded = await createEmbeddedServer({ webRoot: WEB_ROOT, host: HOST, port: PREFERRED_PORT });
    // OBS ブラウザソース用 URL（同一機・透過）を案内。
    // eslint-disable-next-line no-console
    console.log(`[guru] serving ${WEB_ROOT} at ${appOrigin()}`);
    // eslint-disable-next-line no-console
    console.log(`[guru] OBS browser source: ${appOrigin()}/index.html?rx&obs`);
    setupPermissions();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (embedded?.server) embedded.server.close();
    if (process.platform !== 'darwin') app.quit();
  });
}
