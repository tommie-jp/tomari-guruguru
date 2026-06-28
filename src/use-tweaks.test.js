import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mergeIntoDefaults,
  effectiveDefaultsFrom,
  resolveDefaultName,
  resolveDefaultValues,
  shallowEqualValues,
  sanitizePresets,
  serializePresets,
  parsePresetsImport,
  serializeTheme,
  parseThemesImport,
  selectBuiltinPresets,
  isHtmlFallback,
  fetchBuiltinPresets,
  PRESETS_EXPORT_VERSION,
  defaultThemeStorageKey,
  activeThemeStorageKey,
  loadThemeName,
  saveThemeName,
  panelPosStorageKey,
  loadPanelPos,
  savePanelPos,
  clearPanelPos,
  clampPanelPos,
  clampPanelSize,
  panelSizeStorageKey,
  loadPanelSize,
  savePanelSize,
  clearPanelSize,
  sectionStateKey,
  loadSectionState,
  saveSectionState,
  cueOffsetStorageKey,
  loadCueOffsets,
  saveCueOffsets,
  clearCueOffsets,
  clampCueOffset,
  sanitizeCueOffsets,
  equalCueOffsetMaps,
  cueTextStorageKey,
  loadCueTexts,
  saveCueTexts,
  clearCueTexts,
  sanitizeCueTexts,
  MAX_CUE_TEXT_LEN,
  tweaksExportFilename,
  safeThemeName,
  themeExportFilename,
} from './use-tweaks.js';

describe('mergeIntoDefaults', () => {
  it('saved の値で defaults を上書きする', () => {
    const out = mergeIntoDefaults({ a: 2 }, { a: 1, b: 'x' });
    expect(out).toEqual({ a: 2, b: 'x' });
  });

  it('defaults に無いキーは捨てる（前方互換）', () => {
    const out = mergeIntoDefaults({ a: 2, gone: 9 }, { a: 1 });
    expect(out).toEqual({ a: 2 });
  });

  it('saved がオブジェクトでなければ defaults のコピーを返す', () => {
    const defaults = { a: 1 };
    expect(mergeIntoDefaults(null, defaults)).toEqual({ a: 1 });
    expect(mergeIntoDefaults('nope', defaults)).toEqual({ a: 1 });
  });

  it('defaults を破壊しない（新しいオブジェクトを返す）', () => {
    const defaults = { a: 1 };
    const out = mergeIntoDefaults({ a: 2 }, defaults);
    expect(defaults.a).toBe(1);
    expect(out).not.toBe(defaults);
  });
});

describe('effectiveDefaultsFrom', () => {
  it('ビルトインの最初のテーマを defaults にマージして返す', () => {
    const builtins = { first: { a: 9 }, second: { a: 1 } };
    expect(effectiveDefaultsFrom(builtins, { a: 0, b: 'x' })).toEqual({ a: 9, b: 'x' });
  });

  it('「最初」は挿入順で決まる（2件目は無視）', () => {
    const builtins = { 'thema01-for-pc': { a: 1 }, なめらか: { a: 2 } };
    expect(effectiveDefaultsFrom(builtins, { a: 0 })).toEqual({ a: 1 });
  });

  it('部分テーマの未指定キーは defaults で埋まる（前方互換）', () => {
    expect(effectiveDefaultsFrom({ t: { a: 5 } }, { a: 0, b: 7 })).toEqual({ a: 5, b: 7 });
  });

  it('ビルトインが空なら defaults のコピー', () => {
    const defaults = { a: 1 };
    const out = effectiveDefaultsFrom({}, defaults);
    expect(out).toEqual({ a: 1 });
    expect(out).not.toBe(defaults);
  });

  it('ビルトインが不正でも defaults のコピー', () => {
    expect(effectiveDefaultsFrom(null, { a: 1 })).toEqual({ a: 1 });
    expect(effectiveDefaultsFrom('x', { a: 1 })).toEqual({ a: 1 });
  });
});

describe('resolveDefaultName', () => {
  const builtins = { A: { x: 1 }, B: { x: 2 } };
  const presets = { 自作: { x: 9 } };

  it('指定デフォルトが解決できればその名前を返す（ユーザー）', () => {
    expect(resolveDefaultName(builtins, presets, '自作')).toBe('自作');
  });

  it('指定デフォルトが解決できればその名前を返す（ビルトイン）', () => {
    expect(resolveDefaultName(builtins, presets, 'B')).toBe('B');
  });

  it('指定なしなら builtins の先頭', () => {
    expect(resolveDefaultName(builtins, presets, null)).toBe('A');
  });

  it('指定が存在しなければ builtins 先頭にフォールバック', () => {
    expect(resolveDefaultName(builtins, presets, '消えたテーマ')).toBe('A');
  });

  it('builtins が空で指定も無ければ null', () => {
    expect(resolveDefaultName({}, {}, null)).toBeNull();
    expect(resolveDefaultName({}, {}, 'x')).toBeNull();
  });

  it('builtins が空でも presets の指定は解決できる', () => {
    expect(resolveDefaultName({}, presets, '自作')).toBe('自作');
  });

  it('継承プロパティ名(__proto__)は解決名にせず先頭フォールバック', () => {
    expect(resolveDefaultName({ A: { x: 1 } }, {}, '__proto__')).toBe('A');
    expect(resolveDefaultName({}, {}, '__proto__')).toBeNull();
  });
});

describe('resolveDefaultValues', () => {
  const defaults = { x: 0, y: 'd' };
  const builtins = { A: { x: 1 }, B: { x: 2 } };
  const presets = { 自作: { x: 9 } };

  it('指定デフォルト（ユーザー）を defaults にマージして返す', () => {
    expect(resolveDefaultValues(builtins, presets, defaults, '自作')).toEqual({ x: 9, y: 'd' });
  });

  it('指定デフォルト（ビルトイン）を defaults にマージして返す', () => {
    expect(resolveDefaultValues(builtins, presets, defaults, 'B')).toEqual({ x: 2, y: 'd' });
  });

  it('同名はユーザー優先で解決する', () => {
    const b = { 夜: { x: 1 } };
    const p = { 夜: { x: 5 } };
    expect(resolveDefaultValues(b, p, defaults, '夜')).toEqual({ x: 5, y: 'd' });
  });

  it('指定なしは builtins 先頭（effectiveDefaultsFrom と同じ）', () => {
    expect(resolveDefaultValues(builtins, presets, defaults, null)).toEqual({ x: 1, y: 'd' });
  });

  it('指定が存在しなければ builtins 先頭にフォールバック', () => {
    expect(resolveDefaultValues(builtins, presets, defaults, '無い')).toEqual({ x: 1, y: 'd' });
  });

  it('builtins も指定も無ければ defaults のコピー', () => {
    const out = resolveDefaultValues({}, {}, defaults, null);
    expect(out).toEqual({ x: 0, y: 'd' });
    expect(out).not.toBe(defaults);
  });

  it('継承プロパティ名(__proto__)はフォールバックし resolveDefaultName と一致', () => {
    expect(resolveDefaultValues({ A: { x: 1 } }, {}, defaults, '__proto__')).toEqual({ x: 1, y: 'd' });
    expect(resolveDefaultValues({}, {}, defaults, '__proto__')).toEqual({ x: 0, y: 'd' });
  });
});

describe('shallowEqualValues', () => {
  it('同じキー・値なら true', () => {
    expect(shallowEqualValues({ a: 1, b: 'x' }, { a: 1, b: 'x' })).toBe(true);
  });

  it('値が違えば false', () => {
    expect(shallowEqualValues({ a: 1 }, { a: 2 })).toBe(false);
  });

  it('キー数が違えば false', () => {
    expect(shallowEqualValues({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it('NaN 同士は等しい（Object.is）', () => {
    expect(shallowEqualValues({ a: NaN }, { a: NaN })).toBe(true);
  });

  it('オブジェクトでなければ === 比較にフォールバック', () => {
    expect(shallowEqualValues(null, null)).toBe(true);
    expect(shallowEqualValues(null, {})).toBe(false);
  });
});

describe('sanitizePresets', () => {
  it('{名前: プレーンオブジェクト} だけを残す', () => {
    const out = sanitizePresets({ ok: { a: 1 }, bad1: 5, bad2: [1], bad3: null });
    expect(out).toEqual({ ok: { a: 1 } });
  });

  it('空名のキーは捨てる', () => {
    expect(sanitizePresets({ '': { a: 1 } })).toEqual({});
  });

  it('オブジェクトでない入力には空オブジェクト', () => {
    expect(sanitizePresets(null)).toEqual({});
    expect(sanitizePresets([{ a: 1 }])).toEqual({});
    expect(sanitizePresets('x')).toEqual({});
  });
});

describe('serializePresets', () => {
  it('app/version/page/presets のエンベロープを JSON で返す', () => {
    const json = serializePresets({ t1: { a: 1 } }, 'tomari-tweaks:talk.html');
    const parsed = JSON.parse(json);
    expect(parsed.app).toBe('tomari-tweaks');
    expect(parsed.version).toBe(PRESETS_EXPORT_VERSION);
    expect(parsed.page).toBe('tomari-tweaks:talk.html');
    expect(parsed.presets).toEqual({ t1: { a: 1 } });
  });

  it('壊れたプリセットはエクスポート前に取り除く', () => {
    const parsed = JSON.parse(serializePresets({ ok: { a: 1 }, bad: 3 }));
    expect(parsed.presets).toEqual({ ok: { a: 1 } });
  });
});

describe('parsePresetsImport', () => {
  it('エンベロープ形式から presets を取り出す', () => {
    const text = serializePresets({ t1: { a: 1 } }, 'p');
    expect(parsePresetsImport(text)).toEqual({ t1: { a: 1 } });
  });

  it('素のマップ（エンベロープ無し）も受け付ける', () => {
    const text = JSON.stringify({ t1: { a: 1 }, t2: { b: 2 } });
    expect(parsePresetsImport(text)).toEqual({ t1: { a: 1 }, t2: { b: 2 } });
  });

  it('壊れた値は落としつつ有効なものは取り込む', () => {
    const text = JSON.stringify({ presets: { ok: { a: 1 }, bad: 5 } });
    expect(parsePresetsImport(text)).toEqual({ ok: { a: 1 } });
  });

  it('JSON として読めなければ例外', () => {
    expect(() => parsePresetsImport('{not json')).toThrow();
  });

  it('テーマが1件も無ければ例外', () => {
    expect(() => parsePresetsImport(JSON.stringify({ presets: {} }))).toThrow();
    expect(() => parsePresetsImport(JSON.stringify({ bad: 5 }))).toThrow();
  });
});

describe('serializeTheme', () => {
  it('単一テーマのエンベロープ（themeName/theme）を作る', () => {
    const json = serializeTheme('夜', { a: 1 }, 'tomari-tweaks:camera.html');
    const obj = JSON.parse(json);
    expect(obj).toEqual({
      app: 'tomari-tweaks',
      version: PRESETS_EXPORT_VERSION,
      page: 'tomari-tweaks:camera.html',
      themeName: '夜',
      theme: { a: 1 },
    });
  });

  it('bundle と区別できるよう presets キーを持たない', () => {
    const obj = JSON.parse(serializeTheme('t', { a: 1 }, 'p'));
    expect('presets' in obj).toBe(false);
    expect('themeName' in obj).toBe(true);
  });

  it('値が壊れていても theme は {} になる', () => {
    expect(JSON.parse(serializeTheme('t', null, 'p')).theme).toEqual({});
  });

  it('page 未指定は null', () => {
    expect(JSON.parse(serializeTheme('t', { a: 1 })).page).toBeNull();
  });
});

describe('parseThemesImport', () => {
  it('per-file（themeName/theme）を1件のマップにする', () => {
    const text = serializeTheme('夜', { a: 1 }, 'p');
    expect(parseThemesImport(text)).toEqual({ 夜: { a: 1 } });
  });

  it('per-file の themeName は trim する', () => {
    const text = JSON.stringify({ themeName: '  夜  ', theme: { a: 1 } });
    expect(parseThemesImport(text)).toEqual({ 夜: { a: 1 } });
  });

  it('bundle 形式も従来どおり取り込む（後方互換）', () => {
    const text = serializePresets({ t1: { a: 1 }, t2: { b: 2 } }, 'p');
    expect(parseThemesImport(text)).toEqual({ t1: { a: 1 }, t2: { b: 2 } });
  });

  it('素のマップも取り込む（後方互換）', () => {
    const text = JSON.stringify({ t1: { a: 1 } });
    expect(parseThemesImport(text)).toEqual({ t1: { a: 1 } });
  });

  it('per-file で themeName が空なら例外', () => {
    const text = JSON.stringify({ themeName: '   ', theme: { a: 1 } });
    expect(() => parseThemesImport(text)).toThrow();
  });

  it('per-file で theme が不正なら専用メッセージで例外（bundle に落とさない）', () => {
    expect(() => parseThemesImport(JSON.stringify({ themeName: 'x', theme: null })))
      .toThrow('テーマ本体（theme）が不正です');
    expect(() => parseThemesImport(JSON.stringify({ themeName: 'x', theme: [1] })))
      .toThrow('テーマ本体（theme）が不正です');
  });

  it('JSON として読めなければ例外', () => {
    expect(() => parseThemesImport('{not json')).toThrow();
  });
});

describe('selectBuiltinPresets', () => {
  it('page が一致するエンベロープから presets を取り出す', () => {
    const data = { app: 'tomari-tweaks', page: 'tomari-tweaks:camera.html', presets: { 標準: { a: 1 } } };
    expect(selectBuiltinPresets(data, 'tomari-tweaks:camera.html')).toEqual({ 標準: { a: 1 } });
  });

  it('page が現在キーと不一致なら {}（取り違え防止）', () => {
    const data = { page: 'tomari-tweaks:talk.html', presets: { t: { a: 1 } } };
    expect(selectBuiltinPresets(data, 'tomari-tweaks:camera.html')).toEqual({});
  });

  it('page が無ければガードせず取り出す', () => {
    const data = { presets: { t: { a: 1 } } };
    expect(selectBuiltinPresets(data, 'tomari-tweaks:camera.html')).toEqual({ t: { a: 1 } });
  });

  it('素のマップ（エンベロープ無し）も受け付ける', () => {
    expect(selectBuiltinPresets({ t: { a: 1 } }, 'k')).toEqual({ t: { a: 1 } });
  });

  it('壊れた値は落とす', () => {
    const data = { presets: { ok: { a: 1 }, bad: 5 } };
    expect(selectBuiltinPresets(data, null)).toEqual({ ok: { a: 1 } });
  });

  it('オブジェクトでない入力には {}', () => {
    expect(selectBuiltinPresets(null, 'k')).toEqual({});
    expect(selectBuiltinPresets('x', 'k')).toEqual({});
  });
});

describe('isHtmlFallback', () => {
  it('Content-Type が HTML なら true', () => {
    expect(isHtmlFallback('text/html; charset=utf-8', '{}')).toBe(true);
  });

  it('本文が < で始まれば true（Content-Type 無しでも検知）', () => {
    expect(isHtmlFallback('', '<!DOCTYPE html>\n<html>')).toBe(true);
    expect(isHtmlFallback(null, '  <html>')).toBe(true);
  });

  it('正常な JSON 応答は false', () => {
    expect(isHtmlFallback('application/json', '{"presets":{}}')).toBe(false);
  });

  it('壊れた JSON（HTML でない）は false（本物の異常として扱う）', () => {
    expect(isHtmlFallback('application/json', '{not json')).toBe(false);
  });
});

describe('fetchBuiltinPresets', () => {
  let fetchSpy;
  let warnSpy;
  let errorSpy;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    if (fetchSpy) fetchSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  function mockFetch({ ok = true, status = 200, contentType = 'application/json', body = '{}' }) {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok,
      status,
      headers: { get: () => contentType },
      text: async () => body,
    });
  }

  it('正常な JSON 応答からプリセットを取り出す', async () => {
    mockFetch({ body: JSON.stringify({ presets: { 標準: { a: 1 } } }) });
    const out = await fetchBuiltinPresets('/', 'camera', null);
    expect(out).toEqual({ 標準: { a: 1 } });
    expect(fetchSpy).toHaveBeenCalledWith('/default-themes/camera.json');
  });

  it('HTTP 404 は {}（warn のみ、error は出さない）', async () => {
    mockFetch({ ok: false, status: 404, contentType: 'text/html', body: '<!DOCTYPE html>' });
    const out = await fetchBuiltinPresets('/', 'camera', null);
    expect(out).toEqual({});
    expect(warnSpy).toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('200 だが HTML フォールバック応答は {}（error は出さない）', async () => {
    mockFetch({ ok: true, status: 200, contentType: 'text/html', body: '<!DOCTYPE html>\n<html></html>' });
    const out = await fetchBuiltinPresets('/', 'index', null);
    expect(out).toEqual({});
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('200 で本当に壊れた JSON は {}（error を出す）', async () => {
    mockFetch({ ok: true, status: 200, contentType: 'application/json', body: '{not json' });
    const out = await fetchBuiltinPresets('/', 'camera', null);
    expect(out).toEqual({});
    expect(errorSpy).toHaveBeenCalled();
  });

  it('baseUrl を前置してパスを組み立てる', async () => {
    mockFetch({ body: '{}' });
    await fetchBuiltinPresets('/guruguru-avatar/', 'talk', null);
    expect(fetchSpy).toHaveBeenCalledWith('/guruguru-avatar/default-themes/talk.json');
  });
});

describe('clampPanelPos', () => {
  const VP = { width: 1000, height: 800 };
  const SZ = { width: 200, height: 100 };

  it('画面内の位置はそのまま返す', () => {
    expect(clampPanelPos({ left: 300, top: 200 }, VP, SZ, 8))
      .toEqual({ left: 300, top: 200 });
  });

  it('左上の余白(pad)より手前へは出さない', () => {
    expect(clampPanelPos({ left: -50, top: -50 }, VP, SZ, 8))
      .toEqual({ left: 8, top: 8 });
  });

  it('右下はパネルがはみ出さない位置まで戻す', () => {
    // maxLeft = 1000-200-8 = 792, maxTop = 800-100-8 = 692
    expect(clampPanelPos({ left: 9999, top: 9999 }, VP, SZ, 8))
      .toEqual({ left: 792, top: 692 });
  });

  it('パネルが画面より大きくても左上は pad に留める（掴める状態を保証）', () => {
    const big = { width: 2000, height: 2000 };
    expect(clampPanelPos({ left: 500, top: 500 }, VP, big, 8))
      .toEqual({ left: 8, top: 8 });
  });

  it('pad は既定 8', () => {
    expect(clampPanelPos({ left: -50, top: -50 }, VP, SZ))
      .toEqual({ left: 8, top: 8 });
  });
});

describe('clampPanelSize', () => {
  const VP = { width: 1000, height: 800 };
  const MIN = { width: 100, height: 48 };

  it('範囲内のサイズはそのまま返す', () => {
    expect(clampPanelSize({ width: 220, height: 160 }, VP, 8, MIN))
      .toEqual({ width: 220, height: 160 });
  });

  it('最小サイズ未満は最小に引き上げる', () => {
    expect(clampPanelSize({ width: 10, height: 10 }, VP, 8, MIN))
      .toEqual({ width: 100, height: 48 });
  });

  it('画面(から pad*2)を超えるサイズは画面内へ収める', () => {
    // maxW = 1000-16 = 984, maxH = 800-16 = 784
    expect(clampPanelSize({ width: 9999, height: 9999 }, VP, 8, MIN))
      .toEqual({ width: 984, height: 784 });
  });

  it('既定の pad(8)・最小(100x48) が効く', () => {
    expect(clampPanelSize({ width: 0, height: 0 }, VP))
      .toEqual({ width: 100, height: 48 });
  });
});

// localStorage を使うヘルパー群。node 環境（jsdom 無し）なので最小の
// window.localStorage を注入してテストする。
describe('パネル位置の永続化', () => {
  let store;
  beforeEach(() => {
    store = new Map();
    globalThis.window = {
      localStorage: {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
      },
    };
  });
  afterEach(() => {
    delete globalThis.window;
  });

  it('panelPosStorageKey は id ごとにキーを分ける', () => {
    expect(panelPosStorageKey('preview', 'tomari-tweaks:camera'))
      .toBe('tomari-tweaks:camera:panelpos:preview');
    expect(panelPosStorageKey('expr', 'tomari-tweaks:camera'))
      .toBe('tomari-tweaks:camera:panelpos:expr');
  });

  it('save した位置を load で取り戻せる', () => {
    savePanelPos('preview', { left: 120, top: 64 }, 'k');
    expect(loadPanelPos('preview', 'k')).toEqual({ left: 120, top: 64 });
  });

  it('save は left/top だけを保存する（余分なキーは捨てる）', () => {
    savePanelPos('preview', { left: 1, top: 2, junk: 9 }, 'k');
    expect(loadPanelPos('preview', 'k')).toEqual({ left: 1, top: 2 });
  });

  it('未保存なら null', () => {
    expect(loadPanelPos('nope', 'k')).toBeNull();
  });

  it('壊れた JSON は null', () => {
    store.set(panelPosStorageKey('preview', 'k'), '{ broken');
    expect(loadPanelPos('preview', 'k')).toBeNull();
  });

  it('数値でない left/top は null（不正値は既定位置へ）', () => {
    store.set(panelPosStorageKey('p', 'k'), JSON.stringify({ left: 'x', top: 1 }));
    expect(loadPanelPos('p', 'k')).toBeNull();
  });

  it('clear で消すと load は null に戻る', () => {
    savePanelPos('preview', { left: 5, top: 6 }, 'k');
    clearPanelPos('preview', 'k');
    expect(loadPanelPos('preview', 'k')).toBeNull();
  });
});

// パネルサイズ（リサイズ）の永続化。位置と同じ store モックで検証する。
describe('パネルサイズの永続化', () => {
  let store;
  beforeEach(() => {
    store = new Map();
    globalThis.window = {
      localStorage: {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
      },
    };
  });
  afterEach(() => {
    delete globalThis.window;
  });

  it('panelSizeStorageKey は位置とは別キー（:panelsize:）で id ごとに分ける', () => {
    expect(panelSizeStorageKey('debug', 'tomari-tweaks:camera'))
      .toBe('tomari-tweaks:camera:panelsize:debug');
  });

  it('save したサイズを load で取り戻せる（余分なキーは捨てる）', () => {
    savePanelSize('debug', { width: 300, height: 240, junk: 9 }, 'k');
    expect(loadPanelSize('debug', 'k')).toEqual({ width: 300, height: 240 });
  });

  it('未保存なら null', () => {
    expect(loadPanelSize('nope', 'k')).toBeNull();
  });

  it('壊れた JSON は null', () => {
    store.set(panelSizeStorageKey('debug', 'k'), '{ broken');
    expect(loadPanelSize('debug', 'k')).toBeNull();
  });

  it('非正・非数のサイズは null（不正値は中身なりへ）', () => {
    store.set(panelSizeStorageKey('a', 'k'), JSON.stringify({ width: 0, height: 100 }));
    expect(loadPanelSize('a', 'k')).toBeNull();
    store.set(panelSizeStorageKey('b', 'k'), JSON.stringify({ width: 'x', height: 100 }));
    expect(loadPanelSize('b', 'k')).toBeNull();
  });

  it('clear で消すと load は null に戻る', () => {
    savePanelSize('debug', { width: 300, height: 240 }, 'k');
    clearPanelSize('debug', 'k');
    expect(loadPanelSize('debug', 'k')).toBeNull();
  });
});

// セクションの開閉状態（{ ラベル: 開いているか }）の永続化。値とは別キーに置き、
// テーマ export を汚さず resetTweaks でも消えないようにする。
describe('セクション開閉状態の永続化', () => {
  let store;
  beforeEach(() => {
    store = new Map();
    globalThis.window = {
      localStorage: {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
      },
    };
  });
  afterEach(() => {
    delete globalThis.window;
  });

  it('sectionStateKey は :sections を付ける', () => {
    expect(sectionStateKey('tomari-tweaks:camera.html'))
      .toBe('tomari-tweaks:camera.html:sections');
  });

  it('save した開閉マップを load で取り戻せる', () => {
    saveSectionState({ 顔追従: true, ズーム: false }, 'k');
    expect(loadSectionState('k')).toEqual({ 顔追従: true, ズーム: false });
  });

  it('boolean 以外の値は捨てる（不正値を無視）', () => {
    saveSectionState({ ok: true, bad1: 1, bad2: 'x', bad3: null }, 'k');
    expect(loadSectionState('k')).toEqual({ ok: true });
  });

  it('未保存なら {}', () => {
    expect(loadSectionState('k')).toEqual({});
  });

  it('壊れた JSON は {}', () => {
    store.set(sectionStateKey('k'), '{ broken');
    expect(loadSectionState('k')).toEqual({});
  });

  it('オブジェクトでない保存値は {}', () => {
    store.set(sectionStateKey('k'), JSON.stringify([1, 2]));
    expect(loadSectionState('k')).toEqual({});
    store.set(sectionStateKey('k'), JSON.stringify('nope'));
    expect(loadSectionState('k')).toEqual({});
  });
});

// エクスポート JSON のファイル名（guruguru-avatar-tweaks-YYYY-MM-DD-HHMM.json）。
// Date を受け取る純関数なので、固定日時で決定的に検証できる（ローカル時刻を使う）。
describe('tweaksExportFilename', () => {
  it('YYYY-MM-DD-HHMM 形式のファイル名を返す', () => {
    const d = new Date(2026, 5, 19, 21, 34); // 2026-06-19 21:34（月は0始まり）
    expect(tweaksExportFilename(d)).toBe('guruguru-avatar-tweaks-2026-06-19-2134.json');
  });

  it('月日・時分を2桁ゼロ埋めする', () => {
    const d = new Date(2026, 0, 3, 9, 5); // 2026-01-03 09:05
    expect(tweaksExportFilename(d)).toBe('guruguru-avatar-tweaks-2026-01-03-0905.json');
  });

  it('深夜0時0分も 0000 になる', () => {
    const d = new Date(2026, 11, 31, 0, 0); // 2026-12-31 00:00
    expect(tweaksExportFilename(d)).toBe('guruguru-avatar-tweaks-2026-12-31-0000.json');
  });
});

// デフォルト指定テーマ／適用中テーマの「名前1つ」の永続化。値マップ（:presets）
// とは別キーに置き、空/空白は removeItem＝未指定として扱う。
describe('テーマ名（default/active）の永続化', () => {
  let store;
  beforeEach(() => {
    store = new Map();
    globalThis.window = {
      localStorage: {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
      },
    };
  });
  afterEach(() => {
    delete globalThis.window;
  });

  it('キーは :defaultTheme / :activeTheme を付ける', () => {
    expect(defaultThemeStorageKey('tomari-tweaks:camera.html'))
      .toBe('tomari-tweaks:camera.html:defaultTheme');
    expect(activeThemeStorageKey('tomari-tweaks:camera.html'))
      .toBe('tomari-tweaks:camera.html:activeTheme');
  });

  it('save した名前を load で取り戻せる', () => {
    saveThemeName(defaultThemeStorageKey('k'), '夜');
    expect(loadThemeName(defaultThemeStorageKey('k'))).toBe('夜');
  });

  it('未保存なら null', () => {
    expect(loadThemeName(defaultThemeStorageKey('k'))).toBeNull();
  });

  it('空・空白のみ・null は removeItem（未指定）', () => {
    saveThemeName(defaultThemeStorageKey('k'), '夜');
    saveThemeName(defaultThemeStorageKey('k'), '');
    expect(loadThemeName(defaultThemeStorageKey('k'))).toBeNull();
    saveThemeName(defaultThemeStorageKey('k'), '夜');
    saveThemeName(defaultThemeStorageKey('k'), '   ');
    expect(loadThemeName(defaultThemeStorageKey('k'))).toBeNull();
    saveThemeName(defaultThemeStorageKey('k'), '夜');
    saveThemeName(defaultThemeStorageKey('k'), null);
    expect(loadThemeName(defaultThemeStorageKey('k'))).toBeNull();
  });

  it('default と active は独立して保存される', () => {
    saveThemeName(defaultThemeStorageKey('k'), 'A');
    saveThemeName(activeThemeStorageKey('k'), 'B');
    expect(loadThemeName(defaultThemeStorageKey('k'))).toBe('A');
    expect(loadThemeName(activeThemeStorageKey('k'))).toBe('B');
  });

  it('前後空白付きの生値も trim して返す（save と対称）', () => {
    store.set(defaultThemeStorageKey('k'), '  yoru  ');
    expect(loadThemeName(defaultThemeStorageKey('k'))).toBe('yoru');
  });
});

// 単一テーマ書き出しのファイル名（guruguru-avatar-theme-<安全化名>.json）。
describe('safeThemeName / themeExportFilename', () => {
  it('日本語名はそのまま残す', () => {
    expect(safeThemeName('なめらか')).toBe('なめらか');
  });

  it('OS 禁止文字は _ に置換する', () => {
    expect(safeThemeName('a/b:c')).toBe('a_b_c');
    expect(safeThemeName('a\\b*c?')).toBe('a_b_c_');
  });

  it('空白は _ に、先頭末尾の空白と . は除去する', () => {
    expect(safeThemeName('  配信用 夜  ')).toBe('配信用_夜');
    expect(safeThemeName('..hidden.')).toBe('hidden');
  });

  it('空・null は theme にフォールバック', () => {
    expect(safeThemeName('')).toBe('theme');
    expect(safeThemeName(null)).toBe('theme');
    expect(safeThemeName('   ')).toBe('theme');
  });

  it('60文字に切り詰める', () => {
    expect(safeThemeName('あ'.repeat(100))).toBe('あ'.repeat(60));
  });

  it('サロゲートペア（絵文字）を途中で割らない', () => {
    const out = safeThemeName('x' + '😀'.repeat(40));
    expect([...out].length).toBeLessThanOrEqual(60);
    // 末尾に孤立サロゲートが残らない＝encodeURIComponent が throw しない。
    expect(() => encodeURIComponent(out)).not.toThrow();
  });

  it('themeExportFilename は guruguru-avatar-theme-<名前>.json', () => {
    expect(themeExportFilename('夜')).toBe('guruguru-avatar-theme-夜.json');
    expect(themeExportFilename('a/b')).toBe('guruguru-avatar-theme-a_b.json');
  });
});

// 演出（スタンプ）のアバター相対オフセット { [cueId]: {x,y} } の永続化。
// tweaks 値とは別キー（:cueoffset）に置き、テーマ export を汚さず resetTweaks でも
// 消えないようにする（:sections / :panelpos と同じサイドカー方式）。値は em（幅比）。
describe('演出オフセット（:cueoffset）の永続化', () => {
  let store;
  beforeEach(() => {
    store = new Map();
    globalThis.window = {
      localStorage: {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
      },
    };
  });
  afterEach(() => {
    delete globalThis.window;
  });

  it('cueOffsetStorageKey は :cueoffset を付ける（ページ単位の単一マップ）', () => {
    expect(cueOffsetStorageKey('tomari-tweaks:camera.html'))
      .toBe('tomari-tweaks:camera.html:cueoffset');
  });

  it('save した offset マップを load で取り戻せる', () => {
    saveCueOffsets({ hello: { x: 0, y: -0.25 }, anger: { x: 0.1, y: 0 } }, 'k');
    expect(loadCueOffsets('k')).toEqual({ hello: { x: 0, y: -0.25 }, anger: { x: 0.1, y: 0 } });
  });

  it('save は cueId ごとに x/y だけを残す（余分なキーは捨てる）', () => {
    saveCueOffsets({ hello: { x: 1, y: 2, junk: 9 } }, 'k');
    expect(loadCueOffsets('k')).toEqual({ hello: { x: 1, y: 2 } });
  });

  it('非有限・非オブジェクトのエントリは捨てる（不正値を無視）', () => {
    saveCueOffsets({
      ok: { x: 0.2, y: -0.3 },
      bad1: { x: NaN, y: 0 },
      bad2: { x: 0, y: Infinity },
      bad3: 'nope',
      bad4: null,
    }, 'k');
    expect(loadCueOffsets('k')).toEqual({ ok: { x: 0.2, y: -0.3 } });
  });

  it('未保存なら {}', () => {
    expect(loadCueOffsets('k')).toEqual({});
  });

  it('壊れた JSON は {}', () => {
    store.set(cueOffsetStorageKey('k'), '{ broken');
    expect(loadCueOffsets('k')).toEqual({});
  });

  it('オブジェクトでない保存値は {}', () => {
    store.set(cueOffsetStorageKey('k'), JSON.stringify([1, 2]));
    expect(loadCueOffsets('k')).toEqual({});
  });

  it('clear で消すと load は {} に戻る', () => {
    saveCueOffsets({ hello: { x: 1, y: 1 } }, 'k');
    clearCueOffsets('k');
    expect(loadCueOffsets('k')).toEqual({});
  });
});

// 演出（スタンプ）の cue 毎カスタム文字列 { [cueId]: string } の永続化。
// :cueoffset と同じ独立サイドカー方式だが、こちらはテーマに載せない単独キー（:cuetext）。
describe('演出文字（:cuetext）の永続化', () => {
  let store;
  beforeEach(() => {
    store = new Map();
    globalThis.window = {
      localStorage: {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
      },
    };
  });
  afterEach(() => {
    delete globalThis.window;
  });

  it('cueTextStorageKey は :cuetext を付ける（ページ単位の単一マップ）', () => {
    expect(cueTextStorageKey('tomari-tweaks:camera.html'))
      .toBe('tomari-tweaks:camera.html:cuetext');
  });

  it('save した文字マップを load で取り戻せる', () => {
    saveCueTexts({ hello: 'やっほー！', anger: 'ぷんぷん' }, 'k');
    expect(loadCueTexts('k')).toEqual({ hello: 'やっほー！', anger: 'ぷんぷん' });
  });

  it('非文字列・空・空白のみのエントリは捨てる', () => {
    saveCueTexts({
      ok: 'x',
      empty: '',
      blank: '   ',
      num: 5,
      nul: null,
    }, 'k');
    expect(loadCueTexts('k')).toEqual({ ok: 'x' });
  });

  it('前後の空白は trim する', () => {
    saveCueTexts({ hello: '  こんちは  ' }, 'k');
    expect(loadCueTexts('k')).toEqual({ hello: 'こんちは' });
  });

  it('MAX_CUE_TEXT_LEN を超える値は切り詰める', () => {
    const long = 'あ'.repeat(MAX_CUE_TEXT_LEN + 16);
    saveCueTexts({ hello: long }, 'k');
    expect(loadCueTexts('k').hello).toHaveLength(MAX_CUE_TEXT_LEN);
  });

  it('未保存なら {}', () => {
    expect(loadCueTexts('k')).toEqual({});
  });

  it('壊れた JSON は {}', () => {
    store.set(cueTextStorageKey('k'), '{ broken');
    expect(loadCueTexts('k')).toEqual({});
  });

  it('オブジェクトでない保存値は {}', () => {
    store.set(cueTextStorageKey('k'), JSON.stringify([1, 2]));
    expect(loadCueTexts('k')).toEqual({});
  });

  it('clear で消すと load は {} に戻る', () => {
    saveCueTexts({ hello: 'やっほー' }, 'k');
    clearCueTexts('k');
    expect(loadCueTexts('k')).toEqual({});
  });
});

// sanitizeCueTexts: 保存マップを { [cueId]: 非空文字列(<=MAX) } だけに正規化する純関数（DOM 非依存）。
describe('sanitizeCueTexts', () => {
  it('非空文字列はそのまま残す', () => {
    expect(sanitizeCueTexts({ hello: 'やっほー', clap: '👏👏' }))
      .toEqual({ hello: 'やっほー', clap: '👏👏' });
  });

  it('trim し、上限で切り詰める', () => {
    const long = 'b'.repeat(MAX_CUE_TEXT_LEN + 5);
    const out = sanitizeCueTexts({ a: '  hi  ', b: long });
    expect(out.a).toBe('hi');
    expect(out.b).toHaveLength(MAX_CUE_TEXT_LEN);
  });

  it('空 id・空文字・空白のみ・非文字列のエントリは捨てる', () => {
    expect(sanitizeCueTexts({
      ok: 'x',
      '': 'y',
      empty: '',
      blank: '   ',
      num: 5,
      nul: null,
    })).toEqual({ ok: 'x' });
  });

  it('非オブジェクト入力は {}', () => {
    expect(sanitizeCueTexts(null)).toEqual({});
    expect(sanitizeCueTexts([1, 2])).toEqual({});
    expect(sanitizeCueTexts('x')).toEqual({});
  });
});

// clampCueOffset: em オフセットを ±範囲に収め、非有限は 0 に正規化する純関数（DOM 非依存）。
describe('clampCueOffset', () => {
  it('範囲内はそのまま返す', () => {
    expect(clampCueOffset({ x: 0.3, y: -0.4 })).toEqual({ x: 0.3, y: -0.4 });
  });

  it('既定 ±1.5em を超えたら丸める', () => {
    expect(clampCueOffset({ x: 5, y: -5 })).toEqual({ x: 1.5, y: -1.5 });
  });

  it('lo/hi を指定できる', () => {
    expect(clampCueOffset({ x: 5, y: -5 }, -1, 1)).toEqual({ x: 1, y: -1 });
  });

  it('非有限・欠落は 0 に正規化する', () => {
    expect(clampCueOffset({ x: NaN, y: Infinity })).toEqual({ x: 0, y: 0 });
    expect(clampCueOffset(null)).toEqual({ x: 0, y: 0 });
    expect(clampCueOffset({})).toEqual({ x: 0, y: 0 });
  });
});

// sanitizeCueOffsets: 保存マップを { [cueId]: {x,y} } だけに正規化する純関数（export 化）。
// テーマ・サイドカー連携の write 側でライブ保存と同じ正規化を再利用するため公開した。
describe('sanitizeCueOffsets', () => {
  it('正しいエントリはそのまま、x/y 以外のキーは捨てる', () => {
    expect(sanitizeCueOffsets({ hello: { x: 1, y: -2, junk: 9 } }))
      .toEqual({ hello: { x: 1, y: -2 } });
  });

  it('空 id・非オブジェクト・非有限 x/y のエントリは捨てる', () => {
    expect(sanitizeCueOffsets({
      ok: { x: 0.2, y: -0.3 },
      '': { x: 1, y: 1 },
      bad1: { x: NaN, y: 0 },
      bad2: { x: 0, y: Infinity },
      bad3: 'nope',
      bad4: null,
    })).toEqual({ ok: { x: 0.2, y: -0.3 } });
  });

  it('非オブジェクト入力は {}', () => {
    expect(sanitizeCueOffsets(null)).toEqual({});
    expect(sanitizeCueOffsets([1, 2])).toEqual({});
    expect(sanitizeCueOffsets('x')).toEqual({});
  });
});

// equalCueOffsetMaps: 2つの cue オフセットマップが構造的に等しいか（テーマの dirty 判定用）。
describe('equalCueOffsetMaps', () => {
  it('同値なら true（キー順は問わない）', () => {
    expect(equalCueOffsetMaps(
      { hello: { x: 0.1, y: -0.2 }, anger: { x: 0, y: 0.3 } },
      { anger: { x: 0, y: 0.3 }, hello: { x: 0.1, y: -0.2 } },
    )).toBe(true);
  });

  it('空マップ同士は true', () => {
    expect(equalCueOffsetMaps({}, {})).toBe(true);
  });

  it('x または y が違えば false', () => {
    expect(equalCueOffsetMaps({ a: { x: 0.1, y: 0 } }, { a: { x: 0.2, y: 0 } })).toBe(false);
    expect(equalCueOffsetMaps({ a: { x: 0, y: 0.1 } }, { a: { x: 0, y: 0.2 } })).toBe(false);
  });

  it('キー数・キー名が違えば false', () => {
    expect(equalCueOffsetMaps({ a: { x: 0, y: 0 } }, {})).toBe(false);
    expect(equalCueOffsetMaps({ a: { x: 0, y: 0 } }, { b: { x: 0, y: 0 } })).toBe(false);
  });

  it('不正値は正規化後に比較する（捨てた結果が同じなら true）', () => {
    // 片方に不正エントリがあっても、sanitize 後の有効分が一致すれば等しい。
    expect(equalCueOffsetMaps(
      { a: { x: 0.1, y: 0.2 }, bad: { x: NaN, y: 0 } },
      { a: { x: 0.1, y: 0.2 } },
    )).toBe(true);
    // 別参照・別オブジェクトでも構造が同じなら true（参照比較ではない）。
    expect(equalCueOffsetMaps(null, {})).toBe(true);
  });
});
