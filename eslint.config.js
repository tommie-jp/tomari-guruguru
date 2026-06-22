import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

// アプリ側で bare 参照されるアンビエント・グローバル。
// - Tweak*/useTweaks: tweaks-panel.jsx が末尾で Object.assign(window, {...}) し、
//   各 *-app.jsx が import せず参照する設計（別 module script として先に読み込む）。
// - __APP_VERSION__ など: vite.config.js の define で注入されるビルド時定数。
const AMBIENT_GLOBALS = {
  useTweaks: 'readonly',
  TweaksPanel: 'readonly',
  TweakSection: 'readonly',
  TweakRow: 'readonly',
  TweakSlider: 'readonly',
  TweakToggle: 'readonly',
  TweakRadio: 'readonly',
  TweakSelect: 'readonly',
  TweakText: 'readonly',
  TweakNumber: 'readonly',
  TweakColor: 'readonly',
  TweakButton: 'readonly',
  TweakPresets: 'readonly',
  __APP_VERSION__: 'readonly',
  __BUILD_DATE__: 'readonly',
  __GIT_SHA__: 'readonly',
  __TX_PUBLIC_ORIGIN__: 'readonly',
};

export default [
  // 既存コードの意図的な eslint-disable コメント（no-console 等）を尊重し、
  // 「未使用ディレクティブ」では警告しない（将来ルールを有効化したら効く）。
  {
    linterOptions: { reportUnusedDisableDirectives: 'off' },
  },
  {
    ignores: [
      'dist/**',
      'dist-local/**',
      'dist-exe/**',
      'public/mediapipe/**',
      'public/slices2/**',
      'public/slices2-sheets/**',
    ],
  },

  // ブラウザ側（src のアプリ・UI）
  {
    files: ['src/**/*.{js,jsx,mjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.worker, ...AMBIENT_GLOBALS },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      // hooks は実績ある2ルールに限定（v7 recommended の実験的ルール群はゲートに使わない）
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // 大文字始まり/アンダースコアの未使用変数は意図的なことが多いので警告に留める
      'no-unused-vars': ['warn', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_' }],
      // 凡例などの JSX テキスト/コメントに全角スペースを意図的に使う
      'no-irregular-whitespace': ['error', { skipStrings: true, skipTemplates: true, skipComments: true, skipJSXText: true }],
      // ファイル名サニタイザで制御文字クラスを正当に使うため無効化
      'no-control-regex': 'off',
    },
  },

  // Node 側（server / scripts / vite 設定 / リレープラグイン）
  {
    files: ['server/**/*.{js,mjs}', 'scripts/**/*.{js,mjs}', '*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },

  // テスト（vitest）
  {
    files: ['**/*.test.{js,jsx,mjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node, ...globals.vitest },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': 'off',
    },
  },
];
