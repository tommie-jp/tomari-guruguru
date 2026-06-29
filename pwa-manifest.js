// PWA マニフェスト（Web App Manifest）の工場。
//
// ねらい: vite-plugin-pwa に渡す manifest オブジェクトを base から組み立てる。
//   icons[].src / start_url / scope を base 明示プレフィックスで返すことで、
//   GitHub Pages（base=/guruguru-avatar/）でもローカル配信（build:local の base=/）でも
//   同じコードで正しいパスを指す（先頭 / 絶対だと base が付かず 404、相対だと解決元が
//   manifest の場所依存になるため、ここで base を明示連結して両者の曖昧さを消す）。
//
// 対象ページ: index.html（カメラ版・src/camera-app.jsx）。start_url を index.html に固定し、
//   どのページからインストールしてもカメラ版が開くようにする。scope は base 全体にして
//   talk / guruguru / tracking も in-app（standalone）に含める。
//
// 注意: vite.fork.js の base 算出式（env.VITE_BASE || (build ? '/guruguru-avatar/' : '/')）を
//   そのまま渡す前提。base はここで末尾スラッシュを正規化する。

/**
 * @param {string} base Vite の base（例: '/guruguru-avatar/' または '/'）
 * @returns {import('vite-plugin-pwa').ManifestOptions}
 */
export function guruguruPwaManifest(base) {
  const b = base.endsWith('/') ? base : `${base}/`;
  return {
    name: 'ぐるぐるアバター カメラ版',
    short_name: 'ぐるぐる',
    description:
      'Webカメラで顔の向き・口の動きに合わせて同調するブラウザアバター（PixiJS スプライト描画版）。',
    start_url: `${b}index.html`,
    scope: b,
    display: 'standalone',
    orientation: 'any',
    theme_color: '#EEF4FB', // index.html の <meta name="theme-color"> と一致
    background_color: '#EEF4FB',
    lang: 'ja',
    dir: 'ltr',
    icons: [
      { src: `${b}pwa-192x192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `${b}pwa-512x512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: `${b}pwa-maskable-512x512.png`,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
