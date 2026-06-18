// キャラクター設定 — スライス画像の参照先を一元管理
// 新キャラ差し替え時はこのファイルを書き換えるだけ

export default {
  // スライス画像のベースパス（public/ からの相対パス）
  basePath: 'slices2',

  // 画像フォーマット（webp / png）
  ext: 'webp',

  // グリッド構成: rows = 上下（0:上向き → 4:下向き）、cols = 左右（0:左向き → 4:右向き）
  rows: 5,
  cols: 5,

  // シート定義: 目開け×口[とじ/中間/開け] = A/B/C、目閉じ×口[とじ/中間/開け] = D/E/F
  sheets: {
    eyesOpen:   { close: 'A', half: 'B', open: 'C' },
    eyesClosed: { close: 'D', half: 'E', open: 'F' },
  },

  // ファイル名パターンを生成
  src(sheet, r, c) {
    return `${this.basePath}/${sheet}/r${r}c${c}.${this.ext}`;
  },

  // ── スプライトシート方式（camera2.html / PixiJS）─────────────────────────
  // 状態(A〜F)ごとに 5x5 を1枚へ詰めたシート画像のベースパス。
  // tools/pack_sheet.py が public/slices2-sheets/<状態>.webp を生成する。
  sheetBasePath: 'slices2-sheets',

  // 状態シート1枚の参照先。グリッド/セルサイズは実行時にテクスチャ寸法から導出する
  // （sheet幅/cols, sheet高/rows）ので、ここではパスだけ持てばよい。
  sheetSrc(sheet) {
    return `${this.sheetBasePath}/${sheet}.${this.ext}`;
  },
};
