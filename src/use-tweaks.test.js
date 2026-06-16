import { describe, it, expect } from 'vitest';
import {
  mergeIntoDefaults,
  effectiveDefaultsFrom,
  sanitizePresets,
  serializePresets,
  parsePresetsImport,
  selectBuiltinPresets,
  PRESETS_EXPORT_VERSION,
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
