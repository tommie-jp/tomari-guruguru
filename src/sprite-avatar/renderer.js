// PixiJS による「正規化済み5×5シート」のスプライト描画コア。
//
// 役割は「描画」だけ。どのセル(r,c)/状態(A〜F)を出すかは呼び出し側(driver)が
// setCell/setState で指示する（顔推定・音声などの入力には依存しない＝再利用可能）。
//
// シートは tools/pack_sheet.py が生成する等サイズ5×5の1枚絵。各セルは同一サイズに
// 正規化済みなので、テクスチャの frame 矩形でセルを切り出すだけで位置が揃う。
import { Application, Assets, Texture, Rectangle, Sprite } from 'pixi.js';
import { createDissolveFilter } from './effects/dissolve';
import { createGlowFilter } from './effects/glow';

/**
 * @param {HTMLCanvasElement} canvas 描画先 canvas（親要素のサイズに追従する）
 * @param {object} opts
 * @param {string[]} opts.sheets 状態シートURLの配列（index 0..n-1 = setState の引数）
 * @param {number} opts.rows グリッド行数
 * @param {number} opts.cols グリッド列数
 * @param {boolean} [opts.transparent=true] 透過背景（OBS/配信用）
 * @param {number} [opts.initialState=0]
 * @param {{r:number,c:number}} [opts.initialCell]
 * @returns {Promise<{setCell:(r:number,c:number)=>void, setState:(i:number)=>void, app:Application, resize:()=>void, dispose:()=>void}>}
 */
export async function createSpriteAvatar(canvas, {
  sheets,
  rows,
  cols,
  transparent = true,
  initialState = 0,
  initialCell = { r: Math.floor(rows / 2), c: Math.floor(cols / 2) },
}) {
  const app = new Application();
  await app.init({
    canvas,
    // 透過（背景なし）。OBS ブラウザソースやチャット背景にそのまま重ねられる。
    backgroundAlpha: transparent ? 0 : 1,
    // DPR 対応。autoDensity が canvas の style と backing サイズを分けて面倒を見る。
    resolution: typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1,
    autoDensity: true,
    antialias: true,
    // 親要素のレイアウトサイズに追従（charSize 変更・ウィンドウリサイズに自動対応）。
    resizeTo: canvas.parentElement || canvas,
  });

  // 6シートを読み込み、各シートを rows×cols のセルテクスチャ（source 共有の軽量 view）に分割。
  const sources = await Promise.all(sheets.map((url) => Assets.load(url)));
  const cellTextures = sources.map((tex) => {
    const cw = tex.width / cols;
    const ch = tex.height / rows;
    const arr = [];
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        arr.push(new Texture({
          source: tex.source,
          frame: new Rectangle(c * cw, r * ch, cw, ch),
        }));
      }
    }
    return arr; // index = r*cols + c
  });

  let stateIndex = clampIndex(initialState, cellTextures.length);
  let cellIndex = initialCell.r * cols + initialCell.c;

  const sprite = new Sprite(cellTextures[stateIndex][cellIndex]);
  sprite.anchor.set(0.5);
  app.stage.addChild(sprite);

  // 正方セルを正方の親ボックスいっぱいに中央配置（img の inset:0/100% と同じ見え方）。
  // 親サイズは毎フレーム変わりうる（vmin・リサイズ）ので ticker で追従する。
  function layout() {
    const w = app.screen.width;
    const h = app.screen.height;
    const size = Math.min(w, h);
    sprite.width = size;
    sprite.height = size;
    sprite.position.set(w / 2, h / 2);
  }
  layout();
  app.ticker.add(layout);

  function setCell(r, c) {
    cellIndex = r * cols + c;
    sprite.texture = cellTextures[stateIndex][cellIndex];
  }
  function setState(i) {
    stateIndex = clampIndex(i, cellTextures.length);
    sprite.texture = cellTextures[stateIndex][cellIndex];
  }

  // ── エフェクト（Pixi Filter）─────────────────────────────────────────────
  // 各エフェクトを on/off ＋ パラメータで管理し、有効なものを固定順で sprite.filters に並べる。
  // 順序: dissolve(画素を欠く) → glow/bloom(残った画素に発光) の順で重ねる。
  const effects = {
    dissolve: { filter: null, enabled: false },
    glow: { filter: null, enabled: false },
  };
  const EFFECT_ORDER = ['dissolve', 'glow'];

  function rebuildFilters() {
    const list = EFFECT_ORDER
      .filter((k) => effects[k].enabled && effects[k].filter)
      .map((k) => effects[k].filter);
    sprite.filters = list.length ? list : [];
  }

  function makeFilter(name) {
    if (name === 'glow') return createGlowFilter();
    if (name === 'dissolve') return createDissolveFilter();
    return null;
  }

  function applyParams(name, filter, p) {
    if (name === 'glow') {
      const u = filter.resources.glowUniforms.uniforms;
      if (p.strength != null) u.uStrength = p.strength;
      if (p.color != null) u.uColor = colorToRgb01(p.color);
    } else if (name === 'dissolve') {
      const u = filter.resources.dissolveUniforms.uniforms;
      if (p.amount != null) u.uAmount = p.amount;
      if (p.color != null) u.uEdgeColor = colorToRgb01(p.color);
      if (p.scale != null) u.uScale = p.scale;
    }
  }

  // setEffect(name, { enabled, ...params }) — 有効化（必要なら生成）＋パラメータ反映＋再構成。
  function setEffect(name, params = {}) {
    const e = effects[name];
    if (!e) return;
    if (params.enabled && !e.filter) e.filter = makeFilter(name);
    if (e.filter) applyParams(name, e.filter, params);
    e.enabled = !!params.enabled;
    rebuildFilters();
  }

  return {
    app,
    sprite,
    setCell,
    setState,
    setEffect,
    resize() { app.renderer.resize(
      canvas.parentElement?.clientWidth || app.screen.width,
      canvas.parentElement?.clientHeight || app.screen.height,
    ); layout(); },
    dispose() {
      // canvas は React 管理なので removeView:false（DOM からは React が外す）。
      app.destroy(false, { children: true });
    },
  };
}

function clampIndex(i, n) {
  return Math.min(n - 1, Math.max(0, i | 0));
}

// '#rrggbb' / '0xrrggbb' / number → 0xRRGGBB 数値（GlowFilter 用）。
function colorToNum(c) {
  if (typeof c === 'number') return c;
  const hex = String(c).replace(/^#/, '').replace(/^0x/i, '');
  return parseInt(hex, 16) || 0;
}

// 色 → [r,g,b]（0..1, vec3 uniform 用）。
function colorToRgb01(c) {
  const n = colorToNum(c);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}
