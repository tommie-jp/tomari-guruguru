import { describe, it, expect, vi } from 'vitest';
import { isPinchTouch, isZoomWheel, installMobileHardening } from './mobile-hardening.js';

describe('isPinchTouch', () => {
  it('0本指は false（タッチ無し）', () => {
    expect(isPinchTouch(0)).toBe(false);
  });

  it('1本指は false（1本指スクロールは素通しする）', () => {
    expect(isPinchTouch(1)).toBe(false);
  });

  it('2本指は true（ピンチとして抑止対象）', () => {
    expect(isPinchTouch(2)).toBe(true);
  });

  it('3本指以上も true', () => {
    expect(isPinchTouch(3)).toBe(true);
  });
});

describe('isZoomWheel', () => {
  it('ctrlKey なしは false（通常スクロールは素通し）', () => {
    expect(isZoomWheel({ ctrlKey: false })).toBe(false);
  });

  it('ctrlKey ありは true（トラックパッドのピンチ / Ctrl+ホイール）', () => {
    expect(isZoomWheel({ ctrlKey: true })).toBe(true);
  });

  it('null/undefined でも安全に false', () => {
    expect(isZoomWheel(null)).toBe(false);
    expect(isZoomWheel(undefined)).toBe(false);
  });
});

describe('installMobileHardening', () => {
  // jsdom 非導入のため doc/win は addEventListener/removeEventListener を持つプレーンモック
  // を渡す（use-tweaks.test.js と同じ流儀）。
  function makeMock() {
    return { addEventListener: vi.fn(), removeEventListener: vi.fn() };
  }

  it('gesture/touchmove は doc、wheel は win に、すべて passive:false で登録する', () => {
    const doc = makeMock();
    const win = makeMock();
    installMobileHardening(doc, win);

    const docEvents = doc.addEventListener.mock.calls.map((c) => c[0]);
    expect(docEvents).toEqual(
      expect.arrayContaining(['gesturestart', 'gesturechange', 'gestureend', 'touchmove']),
    );
    expect(win.addEventListener).toHaveBeenCalledWith('wheel', expect.any(Function), { passive: false });
    for (const call of doc.addEventListener.mock.calls) {
      expect(call[2]).toEqual({ passive: false });
    }
  });

  it('cleanup で登録した分と同数の removeEventListener を呼ぶ', () => {
    const doc = makeMock();
    const win = makeMock();
    const cleanup = installMobileHardening(doc, win);
    cleanup();
    expect(doc.removeEventListener).toHaveBeenCalledTimes(doc.addEventListener.mock.calls.length);
    expect(win.removeEventListener).toHaveBeenCalledTimes(win.addEventListener.mock.calls.length);
  });

  it('touchmove ハンドラ: 2本指は preventDefault、1本指は呼ばない', () => {
    const doc = makeMock();
    installMobileHardening(doc, makeMock());
    const handler = doc.addEventListener.mock.calls.find((c) => c[0] === 'touchmove')[1];

    const pinch = { touches: { length: 2 }, preventDefault: vi.fn() };
    handler(pinch);
    expect(pinch.preventDefault).toHaveBeenCalled();

    const oneFinger = { touches: { length: 1 }, preventDefault: vi.fn() };
    handler(oneFinger);
    expect(oneFinger.preventDefault).not.toHaveBeenCalled();
  });

  it('wheel ハンドラ: ctrlKey ありは preventDefault、通常は呼ばない', () => {
    const win = makeMock();
    installMobileHardening(makeMock(), win);
    const handler = win.addEventListener.mock.calls.find((c) => c[0] === 'wheel')[1];

    const zoom = { ctrlKey: true, preventDefault: vi.fn() };
    handler(zoom);
    expect(zoom.preventDefault).toHaveBeenCalled();

    const scroll = { ctrlKey: false, preventDefault: vi.fn() };
    handler(scroll);
    expect(scroll.preventDefault).not.toHaveBeenCalled();
  });

  it('gesture ハンドラは無条件で preventDefault（iOS 専用経路）', () => {
    const doc = makeMock();
    installMobileHardening(doc, makeMock());
    const handler = doc.addEventListener.mock.calls.find((c) => c[0] === 'gesturestart')[1];
    const ev = { preventDefault: vi.fn() };
    handler(ev);
    expect(ev.preventDefault).toHaveBeenCalled();
  });
});
