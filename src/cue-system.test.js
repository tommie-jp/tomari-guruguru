import { describe, it, expect, vi } from 'vitest';
import {
  normalizeCue,
  normalizeCues,
  cueById,
  cueForKey,
  parseCueParam,
  isTypingTarget,
  createCueController,
  DEFAULT_GAIN,
  DEFAULT_STAMP_ANIM,
  DEFAULT_STAMP_HOLD_MS,
} from './cue-system';

describe('normalizeCue', () => {
  it('id が無いものは null（最低限 id は必須）', () => {
    expect(normalizeCue({})).toBeNull();
    expect(normalizeCue({ id: '   ' })).toBeNull();
    expect(normalizeCue(null)).toBeNull();
    expect(normalizeCue('hello')).toBeNull();
  });

  it('label 省略時は id を流用、key は1文字小文字に正規化', () => {
    const c = normalizeCue({ id: 'hello', key: 'A' });
    expect(c.id).toBe('hello');
    expect(c.label).toBe('hello');
    expect(c.key).toBe('a');
  });

  it('sound は空文字なら null、tone は正の数のみ採用', () => {
    expect(normalizeCue({ id: 'x', sound: '  ' }).sound).toBeNull();
    expect(normalizeCue({ id: 'x', sound: 'cues/x.mp3' }).sound).toBe('cues/x.mp3');
    expect(normalizeCue({ id: 'x', tone: 0 }).tone).toBeNull();
    expect(normalizeCue({ id: 'x', tone: -5 }).tone).toBeNull();
    expect(normalizeCue({ id: 'x', tone: 660 }).tone).toBe(660);
  });

  it('gain 未指定は DEFAULT_GAIN、負値は無視して既定値', () => {
    expect(normalizeCue({ id: 'x' }).gain).toBe(DEFAULT_GAIN);
    expect(normalizeCue({ id: 'x', gain: -1 }).gain).toBe(DEFAULT_GAIN);
    expect(normalizeCue({ id: 'x', gain: 0.5 }).gain).toBe(0.5);
  });

  it('stamp は空文字なら null、文字列なら前後空白を除去', () => {
    expect(normalizeCue({ id: 'x' }).stamp).toBeNull();
    expect(normalizeCue({ id: 'x', stamp: '   ' }).stamp).toBeNull();
    expect(normalizeCue({ id: 'x', stamp: ' 💢 ' }).stamp).toBe('💢');
  });

  it('anim は既知の種別のみ、未知/未指定は既定の pop', () => {
    expect(normalizeCue({ id: 'x' }).anim).toBe(DEFAULT_STAMP_ANIM);
    expect(normalizeCue({ id: 'x', anim: 'rise' }).anim).toBe('rise');
    expect(normalizeCue({ id: 'x', anim: 'shake' }).anim).toBe('shake');
    expect(normalizeCue({ id: 'x', anim: 'explode' }).anim).toBe(DEFAULT_STAMP_ANIM);
  });

  it('holdMs は範囲内へクランプ、未指定は既定', () => {
    expect(normalizeCue({ id: 'x' }).holdMs).toBe(DEFAULT_STAMP_HOLD_MS);
    expect(normalizeCue({ id: 'x', holdMs: 50 }).holdMs).toBe(200);
    expect(normalizeCue({ id: 'x', holdMs: 99999 }).holdMs).toBe(6000);
    expect(normalizeCue({ id: 'x', holdMs: 800 }).holdMs).toBe(800);
  });

  it('icon は任意（ボタン面用）。空文字/未指定は null', () => {
    expect(normalizeCue({ id: 'x' }).icon).toBeNull();
    expect(normalizeCue({ id: 'x', icon: '  ' }).icon).toBeNull();
    expect(normalizeCue({ id: 'x', icon: ' 👋 ' }).icon).toBe('👋');
  });

  it('effect は glow フラッシュを正規化（glow>0 のみ有効、ms はクランプ）', () => {
    expect(normalizeCue({ id: 'x' }).effect).toBeNull();
    expect(normalizeCue({ id: 'x', effect: {} }).effect).toBeNull();
    expect(normalizeCue({ id: 'x', effect: { glow: 0 } }).effect).toBeNull();
    expect(normalizeCue({ id: 'x', effect: { glow: 6, glowColor: '#FFE08A', ms: 700 } }).effect)
      .toEqual({ glow: 6, glowColor: '#FFE08A', ms: 700 });
    expect(normalizeCue({ id: 'x', effect: { glow: 5 } }).effect).toEqual({ glow: 5, glowColor: null, ms: 700 });
    expect(normalizeCue({ id: 'x', effect: { glow: 5, ms: 99999 } }).effect.ms).toBe(4000);
  });

  it('gesture は動き演出名（文字列のみ、空/非文字列は null）', () => {
    expect(normalizeCue({ id: 'x' }).gesture).toBeNull();
    expect(normalizeCue({ id: 'x', gesture: '  ' }).gesture).toBeNull();
    expect(normalizeCue({ id: 'x', gesture: 42 }).gesture).toBeNull();
    expect(normalizeCue({ id: 'x', gesture: ' nod ' }).gesture).toBe('nod');
  });

  it('音だけ・スタンプだけ・両方ありを許容する', () => {
    expect(normalizeCue({ id: 'snd', tone: 440 })).toMatchObject({ tone: 440, stamp: null });
    expect(normalizeCue({ id: 'stp', stamp: '✨' })).toMatchObject({ tone: null, stamp: '✨' });
    expect(normalizeCue({ id: 'both', tone: 440, stamp: '✨' })).toMatchObject({ tone: 440, stamp: '✨' });
  });
});

describe('normalizeCues', () => {
  it('配列以外は空配列', () => {
    expect(normalizeCues(null)).toEqual([]);
    expect(normalizeCues('x')).toEqual([]);
  });

  it('無効なキューは捨て、id 重複は先勝ち', () => {
    const out = normalizeCues([
      { id: 'a', label: 'A1' },
      { id: 'a', label: 'A2' },
      {},
      { id: 'b' },
    ]);
    expect(out.map((c) => c.id)).toEqual(['a', 'b']);
    expect(cueById(out, 'a').label).toBe('A1');
  });

  it('ホットキー重複は先勝ち（後者はキー無しに降格）', () => {
    const out = normalizeCues([
      { id: 'a', key: '1' },
      { id: 'b', key: '1' },
    ]);
    expect(out[0].key).toBe('1');
    expect(out[1].key).toBeNull();
  });
});

describe('cueForKey / cueById', () => {
  const cues = normalizeCues([
    { id: 'hello', key: '1' },
    { id: 'clap', key: '2' },
  ]);

  it('キーに対応するキューを返す（大文字でも一致）', () => {
    expect(cueForKey(cues, '1').id).toBe('hello');
    expect(cueForKey(cues, '2').id).toBe('clap');
  });

  it('未割当キー・空・null は null', () => {
    expect(cueForKey(cues, '9')).toBeNull();
    expect(cueForKey(cues, '')).toBeNull();
    expect(cueForKey(cues, null)).toBeNull();
  });

  it('cueById は存在しない id で null', () => {
    expect(cueById(cues, 'nope')).toBeNull();
  });
});

describe('parseCueParam', () => {
  it('?cue 無しは空配列', () => {
    expect(parseCueParam('').cues).toEqual([]);
    expect(parseCueParam().cues).toEqual([]);
  });

  it('単一・カンマ区切りの両方を解析（前後空白は除去）', () => {
    expect(parseCueParam('?cue=hello').cues).toEqual(['hello']);
    expect(parseCueParam('?cue=hello, clap ,bye').cues).toEqual(['hello', 'clap', 'bye']);
  });

  it('先頭の ? は任意', () => {
    expect(parseCueParam('cue=hello').cues).toEqual(['hello']);
  });
});

describe('isTypingTarget', () => {
  it('input / textarea / select は true', () => {
    expect(isTypingTarget({ tagName: 'INPUT' })).toBe(true);
    expect(isTypingTarget({ tagName: 'textarea' })).toBe(true);
    expect(isTypingTarget({ tagName: 'SELECT' })).toBe(true);
  });

  it('contentEditable は true、通常要素・null は false', () => {
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isTypingTarget({ tagName: 'DIV' })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('createCueController', () => {
  it('run(id) は該当キューで onTrigger を呼び true、無ければ false', () => {
    const onTrigger = vi.fn();
    const ctl = createCueController([{ id: 'hello', key: '1', tone: 660 }], onTrigger);
    expect(ctl.run('hello')).toBe(true);
    expect(onTrigger).toHaveBeenCalledTimes(1);
    expect(onTrigger.mock.calls[0][0].id).toBe('hello');
    expect(ctl.run('nope')).toBe(false);
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it('runByKey(key) はホットキー経由で発火', () => {
    const onTrigger = vi.fn();
    const ctl = createCueController([{ id: 'hello', key: '1' }], onTrigger);
    expect(ctl.runByKey('1')).toBe(true);
    expect(ctl.runByKey('9')).toBe(false);
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it('cues は正規化済みの配列を露出する', () => {
    const ctl = createCueController([{ id: 'a', key: 'X' }], () => {});
    expect(ctl.cues[0].key).toBe('x');
  });
});
