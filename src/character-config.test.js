import { describe, it, expect } from 'vitest';
import charConfig, { avatars, getAvatar, DEFAULT_AVATAR_ID } from './character-config';

describe('character-config レジストリ', () => {
  it('少なくとも1体のアバターを持ち、既定 id が先頭アバターと一致する', () => {
    expect(avatars.length).toBeGreaterThanOrEqual(1);
    expect(DEFAULT_AVATAR_ID).toBe(avatars[0].id);
  });

  it('id は先頭連番ルール（NN-name、英小文字/数字/_/-）に従う', () => {
    for (const a of avatars) {
      expect(a.id).toMatch(/^\d{2}-[a-z0-9_-]+$/);
    }
  });

  it('各アバターは表示名・グリッド・表情シート・クレジット・帰属を持つ', () => {
    for (const a of avatars) {
      expect(typeof a.displayName).toBe('string');
      expect(a.rows).toBeGreaterThan(0);
      expect(a.cols).toBeGreaterThan(0);
      expect(a.sheets.eyesOpen.close).toBeTruthy();
      expect(a.sheets.eyesClosed.open).toBeTruthy();
      expect(typeof a.credit).toBe('string');
      expect(typeof a.commercial).toBe('boolean');
      // フッターの per-avatar 帰属表示に必要なフィールド。
      expect(a.attribution.name).toBeTruthy();
      expect(a.attribution.url).toMatch(/^https?:\/\//);
      expect(typeof a.attribution.prefix).toBe('string');
      expect(typeof a.attribution.suffix).toBe('string');
    }
  });
});

describe('getAvatar', () => {
  it('既知 id はそのアバターを返す', () => {
    expect(getAvatar('01-tomari').id).toBe('01-tomari');
  });

  it('02-kesyou_jirai_make が登録され、シートURLが id 配下を指す', () => {
    const a = getAvatar('02-kesyou_jirai_make');
    expect(a.id).toBe('02-kesyou_jirai_make');
    expect(a.displayName).toBeTruthy();
    expect(a.sheetSrc('A')).toBe('slices2-sheets/02-kesyou_jirai_make/A.webp');
    expect(a.sheetUrls()).toHaveLength(6);
  });

  it('未知 id は既定アバターへフォールバックする（実行時に落ちない）', () => {
    expect(getAvatar('does-not-exist').id).toBe(DEFAULT_AVATAR_ID);
    expect(getAvatar(undefined).id).toBe(DEFAULT_AVATAR_ID);
  });
});

describe('パス生成', () => {
  const tomari = getAvatar('01-tomari');

  it('sheetSrc は avatar id をパスに含める', () => {
    expect(tomari.sheetSrc('A')).toBe('slices2-sheets/01-tomari/A.webp');
  });

  it('sheetUrls は A〜F の順で6枚返す', () => {
    expect(tomari.sheetUrls()).toEqual([
      'slices2-sheets/01-tomari/A.webp',
      'slices2-sheets/01-tomari/B.webp',
      'slices2-sheets/01-tomari/C.webp',
      'slices2-sheets/01-tomari/D.webp',
      'slices2-sheets/01-tomari/E.webp',
      'slices2-sheets/01-tomari/F.webp',
    ]);
  });

  it('src は slice 方式の個別フレームパスを返す', () => {
    expect(tomari.src('A', 2, 2)).toBe('slices2/A/r2c2.webp');
  });
});

describe('default export（後方互換: 単一キャラ設定）', () => {
  it('既定アバターの設定をそのまま返す', () => {
    expect(charConfig.id).toBe(DEFAULT_AVATAR_ID);
  });

  it('既存コードが使う rows/cols/sheets/src を備える', () => {
    expect(charConfig.rows).toBe(5);
    expect(charConfig.cols).toBe(5);
    expect(charConfig.sheets.eyesOpen.close).toBe('A');
    expect(charConfig.src('A', 0, 0)).toBe('slices2/A/r0c0.webp');
  });
});
