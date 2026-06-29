import { describe, it, expect } from 'vitest';
import { parseDrawParams } from './draw-mode';

describe('parseDrawParams', () => {
  it('draw 未指定は undefined（呼び出し側で既定を決める）', () => {
    expect(parseDrawParams('').draw).toBeUndefined();
    expect(parseDrawParams('?obs=1').draw).toBeUndefined();
  });

  it('?draw（値なし）・?draw=1・?draw=true はいずれも有効', () => {
    expect(parseDrawParams('?draw').draw).toBe(true);
    expect(parseDrawParams('?draw=1').draw).toBe(true);
    expect(parseDrawParams('?draw=true').draw).toBe(true);
    expect(parseDrawParams('?draw=ON').draw).toBe(true);
    expect(parseDrawParams('?draw=yes').draw).toBe(true);
  });

  it('?draw=0 / ?draw=false は明示的に無効化', () => {
    expect(parseDrawParams('?draw=0').draw).toBe(false);
    expect(parseDrawParams('?draw=false').draw).toBe(false);
    expect(parseDrawParams('?draw=no').draw).toBe(false);
  });

  it('先頭の ? は任意・他パラメータと併用できる', () => {
    expect(parseDrawParams('draw=1').draw).toBe(true);
    expect(parseDrawParams('?tx&draw').draw).toBe(true);
    expect(parseDrawParams('?rx&obs=1').draw).toBeUndefined();
  });
});
