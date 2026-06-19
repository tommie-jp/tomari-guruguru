import { describe, it, expect } from 'vitest';
import { parseObsParams } from './obs-mode';

describe('parseObsParams', () => {
  it('obs 未指定は undefined（呼び出し側で rx 既定を決める）', () => {
    const r = parseObsParams('');
    expect(r.obs).toBeUndefined();
  });

  it('?obs（値なし）・?obs=1・?obs=true はいずれも obs モード', () => {
    expect(parseObsParams('?obs').obs).toBe(true);
    expect(parseObsParams('?obs=1').obs).toBe(true);
    expect(parseObsParams('?obs=true').obs).toBe(true);
    expect(parseObsParams('?obs=ON').obs).toBe(true);
  });

  it('?obs=0 / ?obs=false は明示的に無効化（rx の既定 ON を打ち消す）', () => {
    expect(parseObsParams('?obs=0').obs).toBe(false);
    expect(parseObsParams('?obs=false').obs).toBe(false);
  });

  it('先頭の ? は任意（無くても解析できる）', () => {
    expect(parseObsParams('obs=1').obs).toBe(true);
  });

  it('引数を省略しても安全（obs=undefined）', () => {
    const r = parseObsParams();
    expect(r.obs).toBeUndefined();
  });

  it('shadow は解析しない（Tweaks へ移行したため無視）', () => {
    const r = parseObsParams('?obs=1&shadow=3');
    expect(r.obs).toBe(true);
    expect(r.shadow).toBeUndefined();
  });
});
