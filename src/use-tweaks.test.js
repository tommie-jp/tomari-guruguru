import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mergeIntoDefaults,
  effectiveDefaultsFrom,
  sanitizePresets,
  serializePresets,
  parsePresetsImport,
  selectBuiltinPresets,
  isHtmlFallback,
  fetchBuiltinPresets,
  PRESETS_EXPORT_VERSION,
  panelPosStorageKey,
  loadPanelPos,
  savePanelPos,
  clearPanelPos,
  clampPanelPos,
  sectionStateKey,
  loadSectionState,
  saveSectionState,
  tweaksExportFilename,
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
