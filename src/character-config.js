// キャラクター設定レジストリ — 複数アバターの参照先を一元管理する。
//
// 単一キャラ時代の名残で `export default` は「デフォルトアバターの設定」を返す
// （app/talk/camera/apply-state が `charConfig.src/.sheets/.rows/.cols` で使う後方互換）。
// camera（PixiJS スプライト版）は複数アバター対応なので、名前付き export の
// `avatars` / `getAvatar` / `DEFAULT_AVATAR_ID` を使って実行時に切り替える。
//
// 新アバター追加手順:
//   1. tools/slice_character_sheets.py で正規化スライスを生成（生スライスは git 非追跡でよい）
//   2. tools/pack_sheet.py --avatar <id> で public/slices2-sheets/<id>/{A..F}.webp を生成
//   3. ここの AVATAR_DEFS に1エントリ足す（id は先頭に連番を付ける運用ルール）

// スプライトシート（camera 用）の共通ベースパス（public/ からの相対）。
// 実体は public/slices2-sheets/<id>/<状態>.webp。
const SHEET_BASE_PATH = 'slices2-sheets';

// シート定義: 目開け×口[とじ/中間/開け] = A/B/C、目閉じ×口[とじ/中間/開け] = D/E/F。
// 全アバター共通の表情グリッドなので定数として共有する。
const DEFAULT_SHEETS = {
  eyesOpen:   { close: 'A', half: 'B', open: 'C' },
  eyesClosed: { close: 'D', half: 'E', open: 'F' },
};

// A〜F の並び順（camera の setState 引数 index 0..5 に対応）。
const SHEET_ORDER = (sheets) => [
  sheets.eyesOpen.close, sheets.eyesOpen.half, sheets.eyesOpen.open,
  sheets.eyesClosed.close, sheets.eyesClosed.half, sheets.eyesClosed.open,
];

// アバター定義（並び順＝セレクタの表示順）。id は先頭に連番（例 01-tomari）を付ける運用。
const AVATAR_DEFS = [
  {
    id: '01-tomari',
    displayName: 'トマリ',
    // 個別スライス（slice 方式: app/talk/camera が参照）のベースパスと拡張子。
    basePath: 'slices2',
    ext: 'webp',
    rows: 5,
    cols: 5,
    sheets: DEFAULT_SHEETS,
    // 商用利用の可否（CLAUDE.md / ASSET_LICENSE.md: キャラ画像は MIT 対象外・商用利用禁止）。
    commercial: false,
    // Tweaks パネルの「クレジット」行に出す説明文。
    credit: 'トマリぐるぐる（rotejin）— 画像は商用利用禁止',
    // フッターの帰属表示（prefix + リンク名 + suffix）。per-avatar に出し分ける。
    attribution: {
      prefix: 'アバター著作権：',
      name: 'ろてじん',
      url: 'https://github.com/rotejin/tomari-guruguru',
      suffix: ' さん',
    },
  },
  {
    id: '02-kesyou_jirai_make',
    displayName: '化粧地雷メイク',
    // sheet 方式のみ（個別スライスは持たない）。camera は sheetUrls() しか参照しないので
    // basePath/src() は未使用。doAvatarConvert.sh で slices2-sheets/<id>/ を生成する。
    ext: 'webp',
    rows: 5,
    cols: 5,
    sheets: DEFAULT_SHEETS,
    // いらすとや素材を ChatGPT(画像生成)で派生させたもの。いらすとや規約＋OpenAI規約が重なり、
    // 素材を主体とする再配布/販売・商用は高リスクなので非商用に限定する。
    commercial: false,
    credit:
      'いらすとや素材を元に ChatGPT（画像生成）で作成。いらすとや利用規約に従う（商用利用・素材を主体とする再配布/販売は不可）',
    attribution: {
      prefix: 'キャラクター: ',
      name: 'いらすとや',
      url: 'https://www.irasutoya.com/p/terms.html',
      suffix: ' 素材を元に ChatGPT で作成 ／ 非商用',
    },
  },
  {
    id: '03-yumekawa_angel_tenshi',
    displayName: '夢川エンジェル天使',
    // sheet 方式のみ（個別スライスは持たない）。camera は sheetUrls() しか参照しないので
    // basePath/src() は未使用。doAvatarConvert.sh で slices2-sheets/<id>/ を生成する。
    ext: 'webp',
    rows: 5,
    cols: 5,
    sheets: DEFAULT_SHEETS,
    // いらすとや素材を ChatGPT(画像生成)で派生させたもの。いらすとや規約＋OpenAI規約が重なり、
    // 素材を主体とする再配布/販売・商用は高リスクなので非商用に限定する。
    commercial: false,
    credit:
      'いらすとや素材を元に ChatGPT（画像生成）で作成。いらすとや利用規約に従う（商用利用・素材を主体とする再配布/販売は不可）',
    attribution: {
      prefix: 'キャラクター: ',
      name: 'いらすとや',
      url: 'https://www.irasutoya.com/p/terms.html',
      suffix: ' 素材を元に ChatGPT で作成 ／ 非商用',
    },
  },
  {
    id: '04-nijika',
    displayName: '虹夏',
    // sheet 方式のみ（個別スライスは持たない）。camera は sheetUrls() しか参照しないので
    // basePath/src() は未使用。doAvatarConvert.sh で slices2-sheets/<id>/ を生成する。
    ext: 'webp',
    rows: 5,
    cols: 5,
    sheets: DEFAULT_SHEETS,
    // いらすとや素材を ChatGPT(画像生成)で派生させたもの。いらすとや規約＋OpenAI規約が重なり、
    // 素材を主体とする再配布/販売・商用は高リスクなので非商用に限定する。
    commercial: false,
    credit:
      'ChatGPT（画像生成）で作成。（商用利用・素材を主体とする再配布/販売は不可）',
    attribution: {
      prefix: 'キャラクター: ',
      name: 'ChatGPT 生成',
      url: 'https://chatgpt.com/images',
      suffix: 'ChatGPT で作成 ／ 非商用',
    },
  },
];

// 1つの定義オブジェクトに参照ヘルパーを生やしてアバター設定オブジェクトを作る。
function makeAvatar(def) {
  return {
    ...def,

    // 個別スライス1枚の参照先（slice 方式）。例: slices2/A/r2c2.webp
    src(sheet, r, c) {
      return `${this.basePath}/${sheet}/r${r}c${c}.${this.ext}`;
    },

    // スプライトシート1枚の参照先（sheet 方式）。例: slices2-sheets/01-tomari/A.webp
    // グリッド/セルサイズは実行時にテクスチャ寸法から導出するのでパスだけ持てばよい。
    sheetSrc(sheet) {
      return `${SHEET_BASE_PATH}/${this.id}/${sheet}.${this.ext}`;
    },

    // A〜F の6シートURL配列（camera の SpriteAvatar に渡す。index 0..5 = A..F）。
    sheetUrls() {
      return SHEET_ORDER(this.sheets).map((name) => this.sheetSrc(name));
    },
  };
}

// 公開レジストリ。
export const avatars = AVATAR_DEFS.map(makeAvatar);

// 既定アバターの id（URL/保存値が無いときや未知 id のフォールバック）。
export const DEFAULT_AVATAR_ID = avatars[0].id;

// id からアバター設定を引く。未知 id は既定アバターへフォールバック（実行時に落ちない）。
export function getAvatar(id) {
  return avatars.find((a) => a.id === id) || avatars[0];
}

// 後方互換: 既存コードは「単一キャラ設定」を default import で使う。
// 既定アバターの設定をそのまま default export にする。
export default getAvatar(DEFAULT_AVATAR_ID);
