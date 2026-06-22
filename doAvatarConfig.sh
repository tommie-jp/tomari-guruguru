#!/usr/bin/env bash
# doAvatarConfig.sh — assets/<id>/config.js（AVATAR_DEFS に入れるオブジェクトリテラル）を
# 読み、src/character-config.js の AVATAR_DEFS へその id のエントリを「追加 or 更新」する。
#
# やること:
#   1) assets/<id>/config.js を読む（コメントや sheets: DEFAULT_SHEETS を含む JS オブジェクト）
#   2) 先頭の `dummy = ` など最初の `{` より前の前置きを無視し、{ ... } だけを取り出す
#   3) ブレース深さを見て 2スペース基準へ再インデント（4スペース入力でも体裁が揃う）
#   4) AVATAR_DEFS 内に同じ id があれば「その要素だけ」を差し替え、無ければ末尾へ追加
#   5) 生成結果を node --check で構文検証してから書き戻す（壊れた JS は書かない）
#
# config.js はファイル名が .js（.json だとエディタが構文警告を出すため）。中身は JS の
# オブジェクトリテラルで、`dummy = ` を付けて単体でも構文エラーにならない形にしておける。
# 行コメント・末尾カンマ・`sheets: DEFAULT_SHEETS` のような変数参照を含めてよい。
#
# 例（assets/06-elf01/config.js）:
#
#   dummy = {
#     id: '06-elf01',
#     displayName: 'エルフ少女01',
#     ext: 'webp',
#     rows: 5,
#     cols: 5,
#     sheets: DEFAULT_SHEETS,
#     commercial: false,
#     credit: 'ChatGPT（画像生成）で作成。（非商用利用OK,素材を主体とする再配布/販売は不可）',
#     attribution: {
#       prefix: 'キャラクター: ',
#       name: 'ChatGPT 生成',
#       url: 'https://chatgpt.com/images',
#       suffix: 'ChatGPT で作成/非商用',
#     },
#   }
#
# 使い方:
#   ./doAvatarConfig.sh <avatar-id>
#
# 例:
#   ./doAvatarConfig.sh 06-elf01      # assets/06-elf01/config.js を読んで反映
#
# 関連:
#   スプライトシート本体は doAvatarConvert.sh で public/slices2-sheets/<id>/ を生成する。
set -euo pipefail

usage() {
  cat <<'USAGE'
doAvatarConfig.sh — assets/<id>/config.js を読み、src/character-config.js の
AVATAR_DEFS へその id のエントリを追加/更新する。

使い方:
  ./doAvatarConfig.sh <avatar-id>
  ./doAvatarConfig.sh -h | --help

引数:
  avatar-id   反映する ID。assets/<avatar-id>/config.js を入力に使う。
              AVATAR_DEFS に同じ id があれば値を更新、無ければ末尾へ追加する。

入力 (assets/<id>/config.js):
  AVATAR_DEFS の1要素ぶんの JS オブジェクトリテラル。`dummy = ` のように
  最初の `{` より前へ前置きを付けてよい（無視される）。コメント・末尾カンマ・
  `sheets: DEFAULT_SHEETS` のような変数参照も使える（中身は verbatim で挿入し、
  インデントだけ 2スペース基準へ整える）。
  先頭フィールド id は引数 <avatar-id> と一致している必要がある。

出力:
  src/character-config.js を上書き（書き込み前に node --check で構文検証する）。

例:
  ./doAvatarConfig.sh 06-elf01
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ $# -ne 1 ]]; then
  echo "usage: ./doAvatarConfig.sh <avatar-id>" >&2
  echo "       詳細は ./doAvatarConfig.sh -h" >&2
  exit 2
fi

# スクリプトの場所（=リポジトリ）を基準に assets/ と src/ を解決する。どこから呼んでも動く。
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

AVATAR_ID="$1"
CONFIG_PATH="${SCRIPT_DIR}/assets/${AVATAR_ID}/config.js"
TARGET_PATH="${SCRIPT_DIR}/src/character-config.js"

if [[ ! -f "$CONFIG_PATH" ]]; then
  echo "error: config が見つからない: $CONFIG_PATH" >&2
  exit 1
fi
if [[ ! -f "$TARGET_PATH" ]]; then
  echo "error: character-config.js が見つからない: $TARGET_PATH" >&2
  exit 1
fi

# 実体は node に任せる。ブレース/文字列/コメントを尊重して該当オブジェクトだけを差し替える
# （sed/awk の単純な括弧マッチでは attribution の入れ子やコメントで壊れるため）。
AVATAR_ID="$AVATAR_ID" CONFIG_PATH="$CONFIG_PATH" TARGET_PATH="$TARGET_PATH" \
node - <<'NODE'
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const id = process.env.AVATAR_ID;
const configPath = process.env.CONFIG_PATH;
const targetPath = process.env.TARGET_PATH;

function fail(msg) {
  console.error('error: ' + msg);
  process.exit(1);
}

// 開き括弧 openIdx（{ または [）に対応する閉じ括弧の index を返す。
// 文字列リテラル・行/ブロックコメント中の括弧は無視する。見つからなければ -1。
function matchBracket(s, openIdx) {
  let depth = 0, i = openIdx;
  let inStr = null, inLine = false, inBlock = false;
  while (i < s.length) {
    const ch = s[i], nx = s[i + 1];
    if (inLine) { if (ch === '\n') inLine = false; i++; continue; }
    if (inBlock) { if (ch === '*' && nx === '/') { inBlock = false; i += 2; continue; } i++; continue; }
    if (inStr) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === inStr) inStr = null;
      i++; continue;
    }
    if (ch === '/' && nx === '/') { inLine = true; i += 2; continue; }
    if (ch === '/' && nx === '*') { inBlock = true; i += 2; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; i++; continue; }
    if (ch === '{' || ch === '[') { depth++; i++; continue; }
    if (ch === '}' || ch === ']') { depth--; if (depth === 0) return i; i++; continue; }
    i++;
  }
  return -1;
}

// [bodyStart, bodyEnd) の範囲にあるトップレベルの { ... } を列挙する。
// 文字列/コメント中の { は無視する。各要素は {start, end, text}（end は } の次）。
function findTopLevelObjects(s, bodyStart, bodyEnd) {
  const objs = [];
  let i = bodyStart;
  let inStr = null, inLine = false, inBlock = false;
  while (i < bodyEnd) {
    const ch = s[i], nx = s[i + 1];
    if (inLine) { if (ch === '\n') inLine = false; i++; continue; }
    if (inBlock) { if (ch === '*' && nx === '/') { inBlock = false; i += 2; continue; } i++; continue; }
    if (inStr) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === inStr) inStr = null;
      i++; continue;
    }
    if (ch === '/' && nx === '/') { inLine = true; i += 2; continue; }
    if (ch === '/' && nx === '*') { inBlock = true; i += 2; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; i++; continue; }
    if (ch === '{') {
      const end = matchBracket(s, i);
      if (end === -1) fail('オブジェクトの閉じ括弧 } が見つからない（character-config.js の構文を確認）');
      objs.push({ start: i, end: end + 1, text: s.slice(i, end + 1) });
      i = end + 1;
      continue;
    }
    i++;
  }
  return objs;
}

// オブジェクト断片から id フィールドの値を取り出す（無ければ null）。
function objId(text) {
  const m = text.match(/(?:^|[^\w$])id\s*:\s*['"`]([^'"`]*)['"`]/);
  return m ? m[1] : null;
}

// raw（config.js 全体）から最初のトップレベル { ... } だけを取り出す。
// `dummy = ` などの前置きや、} 以降の末尾（; やコメント）を無視する。
function extractObject(raw) {
  let i = 0, inStr = null, inLine = false, inBlock = false;
  while (i < raw.length) {
    const ch = raw[i], nx = raw[i + 1];
    if (inLine) { if (ch === '\n') inLine = false; i++; continue; }
    if (inBlock) { if (ch === '*' && nx === '/') { inBlock = false; i += 2; continue; } i++; continue; }
    if (inStr) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === inStr) inStr = null;
      i++; continue;
    }
    if (ch === '/' && nx === '/') { inLine = true; i += 2; continue; }
    if (ch === '/' && nx === '*') { inBlock = true; i += 2; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; i++; continue; }
    if (ch === '{') {
      const end = matchBracket(raw, i);
      if (end === -1) return null;
      return raw.slice(i, end + 1);
    }
    i++;
  }
  return null;
}

// 1行をスキャンして括弧ネスト深さと「複数行にまたがる文字列/ブロックコメント」状態を更新する。
function scanLine(line, depth, inStr, inBlock) {
  let i = 0, inLine = false;
  while (i < line.length) {
    const ch = line[i], nx = line[i + 1];
    if (inLine) break;
    if (inBlock) { if (ch === '*' && nx === '/') { inBlock = false; i += 2; continue; } i++; continue; }
    if (inStr) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === inStr) inStr = null;
      i++; continue;
    }
    if (ch === '/' && nx === '/') { inLine = true; i += 2; continue; }
    if (ch === '/' && nx === '*') { inBlock = true; i += 2; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; i++; continue; }
    if (ch === '{' || ch === '[') { depth++; i++; continue; }
    if (ch === '}' || ch === ']') { depth--; i++; continue; }
    i++;
  }
  // ' " は行内で閉じる前提（複数行は ` のみ持ち越す）。ブロックコメントは持ち越す。
  if (inStr === "'" || inStr === '"') inStr = null;
  return { depth, inStr, inBlock };
}

// オブジェクトのテキストを base スペース起点・1段2スペースのネストインデントへ整形する。
// 入力のインデント幅（2/4スペース・タブ混在）に依らず一定の体裁になる。
function reindent(block, base) {
  const lines = block.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let depth = 0;            // 各行「開始時点」の括弧ネスト深さ
  let inStr = null, inBlock = false;
  let prevEndsColon = false; // 直前の実体行が `key:` で終わる＝値が次行に続くケース
  for (const line of lines) {
    const continuation = (inStr !== null) || inBlock; // 複数行文字列/コメントの途中
    const content = line.trim();
    if (continuation) {
      out.push(line);                       // 文字列/コメントの中身は触らない
    } else if (content === '') {
      out.push('');
    } else {
      const lead = (content[0] === '}' || content[0] === ']') ? 1 : 0; // 行頭の閉じ括弧は1段浅く
      const extra = (prevEndsColon && !lead) ? 1 : 0;                  // 値継続行は1段深く
      const d = Math.max(0, depth - lead + extra);
      out.push(' '.repeat(base + 2 * d) + content);
      prevEndsColon = /:$/.test(content);
    }
    ({ depth, inStr, inBlock } = scanLine(line, depth, inStr, inBlock));
  }
  return out.join('\n');
}

let raw, src;
try { raw = fs.readFileSync(configPath, 'utf8'); }
catch (e) { fail('config が読めない: ' + configPath); }
try { src = fs.readFileSync(targetPath, 'utf8'); }
catch (e) { fail('character-config.js が読めない: ' + targetPath); }

const objText = extractObject(raw);
if (objText === null) fail('config.js から { ... } のオブジェクトが取り出せない: ' + configPath);
const block = reindent(objText, 2).replace(/,\s*$/, '');
if (!block.trimStart().startsWith('{') || !block.trimEnd().endsWith('}')) {
  fail('config.js の中身が { ... } のオブジェクトになっていない: ' + configPath);
}

const cfgId = objId(block);
if (cfgId === null) fail('config.js に id フィールドが見つからない: ' + configPath);
if (cfgId !== id) fail(`config.js の id ('${cfgId}') が引数 ('${id}') と一致しない`);

// AVATAR_DEFS 配列を特定する。
const decl = src.match(/const\s+AVATAR_DEFS\s*=\s*\[/);
if (!decl) fail('AVATAR_DEFS の宣言が見つからない');
const arrayOpen = decl.index + decl[0].length - 1; // '[' の index
const arrayClose = matchBracket(src, arrayOpen);
if (arrayClose === -1) fail('AVATAR_DEFS 配列の閉じ ] が見つからない');

const objs = findTopLevelObjects(src, arrayOpen + 1, arrayClose);
const existing = objs.find((o) => objId(o.text) === id);

let out;
if (existing) {
  // 既存要素を行頭（インデント込み）から } まで差し替える。末尾のカンマ等はそのまま残す。
  const lineStart = src.lastIndexOf('\n', existing.start) + 1;
  out = src.slice(0, lineStart) + block + src.slice(existing.end);
} else {
  // 末尾要素の後ろ（配列を閉じる ] の行頭）へ新要素を挿入する。
  const closeLineStart = src.lastIndexOf('\n', arrayClose) + 1;
  let prefix = src.slice(0, closeLineStart);
  // 直前要素に末尾カンマが無ければ補う（カンマ漏れ対策）。
  if (objs.length) {
    const last = objs[objs.length - 1];
    const tail = src.slice(last.end, closeLineStart);
    if (!/,/.test(tail)) {
      prefix = src.slice(0, last.end) + ',' + src.slice(last.end, closeLineStart);
    }
  }
  out = prefix + block + ',\n' + src.slice(closeLineStart);
}

// 書き込み前の検証(1): 出力の AVATAR_DEFS に id がちょうど1つ存在するか。
{
  const d = out.match(/const\s+AVATAR_DEFS\s*=\s*\[/);
  const o = d.index + d[0].length - 1;
  const c = matchBracket(out, o);
  if (c === -1) fail('生成結果の配列が壊れている（中止、ファイルは未変更）');
  const n = findTopLevelObjects(out, o + 1, c).filter((x) => objId(x.text) === id).length;
  if (n !== 1) fail(`生成結果の検証に失敗（id='${id}' の要素数=${n}）。ファイルは未変更`);
}

// 書き込み前の検証(2): JS として構文が通るか（一時 .mjs を node --check）。
{
  const tmp = path.join(os.tmpdir(), `charcfg-check-${process.pid}.mjs`);
  fs.writeFileSync(tmp, out);
  try {
    cp.execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (_) {}
    const detail = e.stderr ? e.stderr.toString() : e.message;
    fail('生成結果が JS として不正（中止、ファイルは未変更）:\n' + detail);
  }
  fs.unlinkSync(tmp);
}

fs.writeFileSync(targetPath, out);
console.log(
  existing
    ? `updated: AVATAR_DEFS の '${id}' を更新しました`
    : `added: AVATAR_DEFS に '${id}' を追加しました`
);
NODE

echo "done. 確認: src/character-config.js / シート未生成なら ./doAvatarConvert.sh assets/${AVATAR_ID} ${AVATAR_ID}"
