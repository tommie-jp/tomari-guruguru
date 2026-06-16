import { describe, it, expect } from 'vitest';
import { parseObsParams } from './obs-mode';

describe('parseObsParams', () => {
  it('パラメータ無しは通常モード（obs/shadow とも false）', () => {
    const r = parseObsParams('');
    expect(r.obs).toBe(false);
    expect(r.shadow).toBe(false);
  });

  it('?obs（値なし）・?obs=1・?obs=true はいずれも obs モード', () => {
    expect(parseObsParams('?obs').obs).toBe(true);
    expect(parseObsParams('?obs=1').obs).toBe(true);
    expect(parseObsParams('?obs=true').obs).toBe(true);
    expect(parseObsParams('?obs=ON').obs).toBe(true);
  });

  it('?obs=0 / ?obs=false は無効化できる', () => {
    expect(parseObsParams('?obs=0').obs).toBe(false);
    expect(parseObsParams('?obs=false').obs).toBe(false);
  });

  it('?shadow で影フラグが立つ', () => {
    const r = parseObsParams('?obs=1&shadow=1');
    expect(r.obs).toBe(true);
    expect(r.shadow).toBe(true);
  });

  it('先頭の ? は任意（無くても解析できる）', () => {
    expect(parseObsParams('obs=1').obs).toBe(true);
  });

  it('引数を省略しても安全（既定で通常モード）', () => {
    const r = parseObsParams();
    expect(r.obs).toBe(false);
    expect(r.shadow).toBe(false);
  });
});
