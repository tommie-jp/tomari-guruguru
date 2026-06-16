import { describe, it, expect } from 'vitest';
import { parseObsParams, parseShadowLevel } from './obs-mode';

describe('parseObsParams', () => {
  it('パラメータ無しは通常モード（obs=false / shadow=0）', () => {
    const r = parseObsParams('');
    expect(r.obs).toBe(false);
    expect(r.shadow).toBe(0);
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

  it('?shadow=n で影レベル(0~3)になる', () => {
    expect(parseObsParams('?obs=1&shadow=1').shadow).toBe(1);
    expect(parseObsParams('?shadow=3').shadow).toBe(3);
    expect(parseObsParams('?shadow=5').shadow).toBe(3); // 上限クランプ
    expect(parseObsParams('?shadow=0').shadow).toBe(0);
  });

  it('先頭の ? は任意（無くても解析できる）', () => {
    expect(parseObsParams('obs=1').obs).toBe(true);
  });

  it('引数を省略しても安全（obs=false / shadow=0）', () => {
    const r = parseObsParams();
    expect(r.obs).toBe(false);
    expect(r.shadow).toBe(0);
  });
});

describe('parseShadowLevel', () => {
  it('null（パラメータ無し）は 0', () => {
    expect(parseShadowLevel(null)).toBe(0);
  });

  it('空文字（?shadow 値なし）は既定の 2', () => {
    expect(parseShadowLevel('')).toBe(2);
  });

  it('0~3 はそのまま整数で返す', () => {
    expect(parseShadowLevel('0')).toBe(0);
    expect(parseShadowLevel('1')).toBe(1);
    expect(parseShadowLevel('2')).toBe(2);
    expect(parseShadowLevel('3')).toBe(3);
  });

  it('範囲外はクランプ（負→0、4以上→3）', () => {
    expect(parseShadowLevel('-1')).toBe(0);
    expect(parseShadowLevel('9')).toBe(3);
  });

  it('数値でなければ 0', () => {
    expect(parseShadowLevel('foo')).toBe(0);
  });

  it('小数は四捨五入', () => {
    expect(parseShadowLevel('2.4')).toBe(2);
    expect(parseShadowLevel('2.6')).toBe(3);
  });
});
