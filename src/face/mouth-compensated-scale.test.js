import { describe, it, expect } from 'vitest';
import { compensateScaleForMouth } from './mouth-compensated-scale';

describe('compensateScaleForMouth', () => {
  it('comp=0（既定）なら無補正で素通し', () => {
    expect(compensateScaleForMouth(0.4, 1)).toBeCloseTo(0.4, 5);
    expect(compensateScaleForMouth(0.4, 1, 0)).toBeCloseTo(0.4, 5);
  });

  it('口を閉じている(mouth=0)なら comp によらず素通し', () => {
    expect(compensateScaleForMouth(0.4, 0, 0.5)).toBeCloseTo(0.4, 5);
  });

  it('口を開く(mouth>0)と縮める＝顎ドロップ分を打ち消す', () => {
    const raw = 0.4;
    const out = compensateScaleForMouth(raw, 1, 0.2);
    expect(out).toBeLessThan(raw);
    expect(out).toBeCloseTo(raw * (1 - 0.2), 5); // mouth=1 で (1-comp) 倍
  });

  it('開き量に比例（mouth=0.5・comp=0.2 で半分の効き）', () => {
    const raw = 0.4;
    const out = compensateScaleForMouth(raw, 0.5, 0.2);
    expect(out).toBeCloseTo(raw * (1 - 0.2 * 0.5), 5); // = raw*0.9
  });

  it('mouth は 0..1 にクランプ（暴発防止）', () => {
    const at1 = compensateScaleForMouth(0.4, 1, 0.3);
    const beyond = compensateScaleForMouth(0.4, 2.5, 0.3);
    expect(beyond).toBeCloseTo(at1, 5);
    const below = compensateScaleForMouth(0.4, -1, 0.3);
    expect(below).toBeCloseTo(0.4, 5); // 負はクランプ→無補正相当
  });

  it('縮小は maxReduction で頭打ち（行き過ぎ防止）', () => {
    // comp=2・mouth=1 は factor=-1 だが floor=1-0.6=0.4 で頭打ち
    const out = compensateScaleForMouth(1.0, 1, 2);
    expect(out).toBeCloseTo(0.4, 5);
    // maxReduction を渡して上書きできる
    const out2 = compensateScaleForMouth(1.0, 1, 2, { maxReduction: 0.3 });
    expect(out2).toBeCloseTo(0.7, 5);
  });

  it('サイズ0以下は0（顔ロスト相当）', () => {
    expect(compensateScaleForMouth(0, 1, 0.2)).toBe(0);
    expect(compensateScaleForMouth(-0.2, 1, 0.2)).toBe(0);
  });

  it('mouth が不正値なら素通し', () => {
    expect(compensateScaleForMouth(0.4, NaN, 0.2)).toBeCloseTo(0.4, 5);
    expect(compensateScaleForMouth(0.4, Infinity, 0.2)).toBeCloseTo(0.4, 5);
  });
});
