import { describe, it, expect } from 'vitest';
import {
  parseCameraParam,
  resolveCameraDevice,
  formatCameraLabel,
  buildCameraConstraints,
} from './camera-config';

describe('parseCameraParam', () => {
  it('?camera=<ラベル> を返す（前後空白は trim）', () => {
    expect(parseCameraParam('?camera=Front')).toBe('Front');
    expect(parseCameraParam('?camera=%20Logitech%20')).toBe('Logitech');
  });

  it('番号は文字列のまま返す（解決は resolveCameraDevice に委ねる）', () => {
    expect(parseCameraParam('?camera=0')).toBe('0');
  });

  it('未指定・空・解析不可は null', () => {
    expect(parseCameraParam('')).toBeNull();
    expect(parseCameraParam('?avatar=01-tomari')).toBeNull();
    expect(parseCameraParam('?camera=')).toBeNull();
    expect(parseCameraParam('?camera=%20%20')).toBeNull();
  });

  it('先頭の ? は任意', () => {
    expect(parseCameraParam('camera=Back')).toBe('Back');
  });
});

describe('resolveCameraDevice', () => {
  const devices = [
    { deviceId: 'id-front', label: 'Front Camera' },
    { deviceId: 'id-back', label: 'Back Camera' },
    { deviceId: 'id-back2', label: 'Back Camera High Res' },
  ];

  it('完全一致を部分一致より優先する', () => {
    // 'Back Camera' は 'Back Camera High Res' にも部分一致するが完全一致を採る
    expect(resolveCameraDevice(devices, 'Back Camera')).toBe('id-back');
  });

  it('部分一致は大文字小文字を無視する', () => {
    expect(resolveCameraDevice(devices, 'front')).toBe('id-front');
  });

  it('複数の部分一致はラベルが短い順（より特定的）で決定化する', () => {
    // 'Back' は id-back / id-back2 の両方に一致 → 短いラベルの id-back
    expect(resolveCameraDevice(devices, 'Back')).toBe('id-back');
  });

  it('番号は N 番目（0 始まり）、範囲外は null', () => {
    expect(resolveCameraDevice(devices, '0')).toBe('id-front');
    expect(resolveCameraDevice(devices, '2')).toBe('id-back2');
    expect(resolveCameraDevice(devices, '9')).toBeNull();
  });

  it('未一致・空・null・未列挙は null', () => {
    expect(resolveCameraDevice(devices, 'NoSuchCam')).toBeNull();
    expect(resolveCameraDevice(devices, '')).toBeNull();
    expect(resolveCameraDevice(devices, null)).toBeNull();
    expect(resolveCameraDevice([], 'Front')).toBeNull();
  });

  it('ラベルが空のデバイスは部分一致の対象外', () => {
    const noLabel = [{ deviceId: 'id-x', label: '' }];
    expect(resolveCameraDevice(noLabel, 'cam')).toBeNull();
  });
});

describe('formatCameraLabel', () => {
  it('ラベルがあればそのまま', () => {
    expect(formatCameraLabel('Logitech BRIO', 0)).toBe('Logitech BRIO');
  });

  it('空なら「カメラ N」（1 始まり表示）', () => {
    expect(formatCameraLabel('', 0)).toBe('カメラ 1');
    expect(formatCameraLabel('', 2)).toBe('カメラ 3');
  });
});

describe('buildCameraConstraints', () => {
  it('deviceId 指定時は video.deviceId.exact を含み width/height を保持', () => {
    const c = buildCameraConstraints('id-front', 'user');
    expect(c.video.deviceId).toEqual({ exact: 'id-front' });
    expect(c.video.width).toEqual({ ideal: 640 });
    expect(c.video.height).toEqual({ ideal: 480 });
    expect(c.video.facingMode).toBeUndefined(); // deviceId 優先なので向きは付けない
    expect(c.audio).toBe(false);
  });

  it('deviceId 無しは facingMode をヒントに（deviceId キーは含まない）', () => {
    const c = buildCameraConstraints(null, 'environment');
    expect(c.video.deviceId).toBeUndefined();
    expect(c.video.facingMode).toBe('environment');
    expect(c.video.width).toEqual({ ideal: 640 });
    expect(c.audio).toBe(false);
  });

  it('facingMode 既定は user', () => {
    expect(buildCameraConstraints(null).video.facingMode).toBe('user');
  });
});
