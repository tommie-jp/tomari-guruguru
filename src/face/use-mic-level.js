// useMicLevel — マイク音量(生 RMS)を levelRef.current(0..1 程度)に毎フレーム書く React フック。
//
// 口パクのマイクソース用。スケール(micGain)としきい値・エンベロープは下流(compose-signals →
// computeStateFrame)が担うので、ここでは engine.level() の生値を書くだけ。
//
// AudioContext は自動再生制約があるため、開始は基本的にユーザー操作(設定トグルのクリック等)に
// 伴って enabled が立つ流れで行う。永続値で mount 時から enabled の場合に備え、初回の
// pointerdown/keydown で resume する保険も張る。
import React from 'react';
import { makeAudioEngine } from '../audio/mic-engine.js';

const { useState, useEffect, useMemo } = React;

/**
 * @param {{ current: number }} levelRef 書き込み先（マイク RMS）
 * @param {{ enabled?: boolean }} [opts]
 * @returns {{ status: { phase: string, error: string|null } }}
 */
export function useMicLevel(levelRef, opts = {}) {
  const { enabled = true } = opts;
  const engine = useMemo(() => makeAudioEngine(), []);
  const [status, setStatus] = useState({ phase: 'idle', error: null });

  useEffect(() => {
    if (!enabled) {
      engine.stopMic();
      levelRef.current = 0;
      setStatus({ phase: 'idle', error: null });
      return undefined;
    }

    let cancelled = false;
    let raf = 0;
    setStatus({ phase: 'loading', error: null });

    engine.startMic()
      .then(() => {
        if (cancelled) {
          engine.stopMic();
          return;
        }
        setStatus({ phase: 'running', error: null });
        const loop = () => {
          if (cancelled) return;
          levelRef.current = engine.level();
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
      })
      .catch((err) => {
        if (cancelled) return;
        levelRef.current = 0;
        setStatus({ phase: 'error', error: err?.message || String(err) });
      });

    // 自動再生制約: 初回のユーザー操作で AudioContext を resume（mount 時 enabled の保険）。
    const unlock = () => engine.resume();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      engine.stopMic();
      levelRef.current = 0;
    };
  }, [enabled, engine, levelRef]);

  return { status };
}
