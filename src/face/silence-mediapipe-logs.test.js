import { describe, it, expect, vi, afterEach } from 'vitest';
import { isMediaPipeNoise, silenceMediaPipeLogs } from './silence-mediapipe-logs';

describe('isMediaPipeNoise', () => {
  it('glog の warning(W) 行を検出する', () => {
    const line =
      'W0615 08:32:29.608999 2136208 face_landmarker_graph.cc:180] Sets FaceBlendshapesGraph acceleration to xnnpack by default.';
    expect(isMediaPipeNoise([line])).toBe(true);
  });

  it('glog の info(I) 行を検出する', () => {
    const line =
      'I0615 08:32:29.663000 2136208 gl_context.cc:407] GL version: 3.0 (OpenGL ES 3.0)';
    expect(isMediaPipeNoise([line])).toBe(true);
  });

  it('"Graph successfully started running." を検出する', () => {
    expect(isMediaPipeNoise(['Graph successfully started running.'])).toBe(true);
  });

  it('TFLite の "INFO: Created TensorFlow Lite XNNPACK delegate ..." を検出する', () => {
    expect(
      isMediaPipeNoise(['INFO: Created TensorFlow Lite XNNPACK delegate for CPU.']),
    ).toBe(true);
  });

  it('error(E)/fatal(F) 行は本物の問題なので残す', () => {
    expect(isMediaPipeNoise(['E0615 08:32:29.000000 2136208 foo.cc:1] real error'])).toBe(false);
    expect(isMediaPipeNoise(['F0615 08:32:29.000000 2136208 foo.cc:1] fatal'])).toBe(false);
  });

  it('通常のアプリログや非文字列は残す', () => {
    expect(isMediaPipeNoise(['hello world'])).toBe(false);
    expect(isMediaPipeNoise([new Error('boom')])).toBe(false);
    expect(isMediaPipeNoise([])).toBe(false);
    expect(isMediaPipeNoise([42])).toBe(false);
  });
});

describe('silenceMediaPipeLogs', () => {
  let restore = null;
  afterEach(() => {
    if (restore) restore();
    restore = null;
  });

  it('ノイズは落とし、本物のログは通す', () => {
    const errorSpy = vi.fn();
    const target = { error: errorSpy, warn: vi.fn(), info: vi.fn(), log: vi.fn(), debug: vi.fn() };
    restore = silenceMediaPipeLogs(target);

    target.error('W0615 08:32:29.664 1 gl_context.cc:1118] OpenGL error checking is disabled');
    target.error('Graph successfully started running.');
    target.error('something actually broke');

    // ラップ後の target.error はラッパなので、元のスパイ参照で検証する。
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith('something actually broke');
  });

  it('restore で元の console に戻る', () => {
    const original = vi.fn();
    const target = { error: original };
    restore = silenceMediaPipeLogs(target);
    expect(target.error).not.toBe(original);
    restore();
    restore = null;
    expect(target.error).toBe(original);
  });

  it('多重呼び出ししても二重ラップしない', () => {
    const target = { error: vi.fn() };
    const first = silenceMediaPipeLogs(target);
    const wrapped = target.error;
    const second = silenceMediaPipeLogs(target);
    restore = first;
    expect(target.error).toBe(wrapped);
    expect(second).toBe(first);
  });
});
