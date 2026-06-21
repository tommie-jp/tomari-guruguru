// 「キュー（演出トリガー）」の純粋ロジック。音声・DOM には依存しない。
//
// ねらい: ホットキー / ?cue= / オンスクリーンボタン という複数の発火経路を、
// すべて同じ run(id) に集約するための土台。第一弾は「音」を鳴らすだけだが、
// 将来 effect（Pixi 演出）や expression（表情上書き）も同じキューに足せるよう、
// ここでは「何を起こすか」を持たず、onTrigger(cue) へ委譲する設計にしている。
//
// 音声→口パクの自動連動は今回は対象外（後回し）。このモジュールは音にも非依存。

export const DEFAULT_GAIN = 1;

// スタンプ（リアクション表示）のアニメ種別と表示時間の既定・範囲。
export const STAMP_ANIMS = ['pop', 'rise', 'shake'];
export const DEFAULT_STAMP_ANIM = 'pop';
export const DEFAULT_STAMP_HOLD_MS = 1100;
const STAMP_HOLD_MIN = 200;
const STAMP_HOLD_MAX = 6000;

function clampNum(v, lo, hi, fallback) {
  if (!Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, v));
}

// 入力中（テキスト入力欄）はホットキーを無効化するための判定。
// 設定パネルでキー名を打ち込んでいる最中に演出が暴発しないようにする。
export function isTypingTarget(el) {
  if (!el) return false;
  const tag = (el.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

// ホットキーは「1文字・小文字」に正規化する。'A' と 'a' を同一視するため。
function normKey(k) {
  if (typeof k !== 'string') return null;
  const s = k.trim().toLowerCase();
  return s ? s[0] : null;
}

// 演出エフェクト（今はグローのフラッシュのみ）を正規化。glow>0 のときだけ有効。
// 表示側で「一定時間だけグローを強める」フラッシュとして使う。transform には触れない。
function normalizeEffect(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const glow = Number.isFinite(raw.glow) && raw.glow > 0 ? raw.glow : 0;
  if (!glow) return null;
  const glowColor = typeof raw.glowColor === 'string' && raw.glowColor.trim() ? raw.glowColor.trim() : null;
  const ms = clampNum(raw.ms, 100, 4000, 700);
  return { glow, glowColor, ms };
}

/**
 * 1件のキュー定義を正規化（既定値補完＋型の安全化）。
 * id が無いものは無効として null を返す。
 * 音（sound/tone/gain）とスタンプ（stamp/anim/holdMs）はどちらも任意で、
 * 片方だけ・両方ありを許容する（音だけ／スタンプだけ／音＋スタンプ）。
 * icon はボタン面に出す短い絵柄。stamp が長文のときに面が崩れないよう分離する。
 * effect は任意の演出エフェクト（グローのフラッシュ）。1ボタンで 音＋スタンプ＋発光 を束ねる。
 * gesture は任意の動き演出名（'nod'/'spin'/'shake' 等）。表示側が gestures.js で再生する。
 * @returns {{id,label,key,sound,tone,gain,stamp,anim,holdMs,icon,effect,gesture}|null}
 */
export function normalizeCue(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!id) return null;
  const key = normKey(raw.key);
  const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : id;
  const sound = typeof raw.sound === 'string' && raw.sound.trim() ? raw.sound.trim() : null;
  const tone = Number.isFinite(raw.tone) && raw.tone > 0 ? raw.tone : null;
  const gain = Number.isFinite(raw.gain) && raw.gain >= 0 ? raw.gain : DEFAULT_GAIN;
  const stamp = typeof raw.stamp === 'string' && raw.stamp.trim() ? raw.stamp.trim() : null;
  const anim = STAMP_ANIMS.includes(raw.anim) ? raw.anim : DEFAULT_STAMP_ANIM;
  const holdMs = clampNum(raw.holdMs, STAMP_HOLD_MIN, STAMP_HOLD_MAX, DEFAULT_STAMP_HOLD_MS);
  const icon = typeof raw.icon === 'string' && raw.icon.trim() ? raw.icon.trim() : null;
  const effect = normalizeEffect(raw.effect);
  const gesture = typeof raw.gesture === 'string' && raw.gesture.trim() ? raw.gesture.trim() : null;
  return { id, label, key, sound, tone, gain, stamp, anim, holdMs, icon, effect, gesture };
}

/**
 * キュー配列を正規化。無効を捨て、id 重複は先勝ち、ホットキー重複も先勝ち
 *（後から来た同キーはキー無しへ降格）。
 * @param {Array} rawList
 * @returns {Array}
 */
export function normalizeCues(rawList) {
  if (!Array.isArray(rawList)) return [];
  const out = [];
  const ids = new Set();
  const keys = new Set();
  for (const raw of rawList) {
    const c = normalizeCue(raw);
    if (!c) continue;
    if (ids.has(c.id)) continue; // id 重複は先勝ち
    let key = c.key;
    if (key && keys.has(key)) key = null; // キー重複は先勝ち（後者は無効化）
    ids.add(c.id);
    if (key) keys.add(key);
    out.push({ ...c, key });
  }
  return out;
}

export function cueById(cues, id) {
  if (!Array.isArray(cues)) return null;
  return cues.find((c) => c.id === id) || null;
}

export function cueForKey(cues, key) {
  const k = normKey(key);
  if (!k || !Array.isArray(cues)) return null;
  return cues.find((c) => c.key === k) || null;
}

/**
 * URL の search から自動発火キューを解析する純関数。
 * ?cue=hello            → { cues: ['hello'] }
 * ?cue=hello,clap,bye   → { cues: ['hello','clap','bye'] }
 * @param {string} [search] location.search 相当（先頭 ? は任意）
 * @returns {{ cues: string[] }}
 */
export function parseCueParam(search = '') {
  const params = new URLSearchParams(search);
  const raw = params.get('cue');
  if (!raw) return { cues: [] };
  const cues = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return { cues };
}

/**
 * run(id) / runByKey(key) を提供する薄いコントローラ。
 * 実際の演出（音再生など）は onTrigger(cue) に委譲するのでテストしやすく、
 * 後から effect / expression を足すときも発火経路はここを通せる。
 * @param {Array} cues 生のキュー定義配列（内部で正規化する）
 * @param {(cue:object)=>void} onTrigger 発火時に呼ばれる
 */
export function createCueController(cues, onTrigger) {
  const list = normalizeCues(cues);
  const fire = typeof onTrigger === 'function' ? onTrigger : () => {};
  function run(id) {
    const cue = cueById(list, id);
    if (!cue) return false;
    fire(cue);
    return true;
  }
  function runByKey(key) {
    const cue = cueForKey(list, key);
    if (!cue) return false;
    fire(cue);
    return true;
  }
  return { cues: list, run, runByKey };
}
