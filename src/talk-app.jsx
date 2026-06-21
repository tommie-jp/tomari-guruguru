import React from 'react';
import ReactDOM from 'react-dom/client';
import charConfig from './character-config';
import { installMobileHardening } from './mobile-hardening.js';
import { applyThemeColor } from './theme-color.js';
import { GESTURES, sampleGesture, gestureTransform } from './gestures.js';
import { createSoundboard } from './cue-audio.js';
import { createCueController, isTypingTarget, parseCueParam } from './cue-system.js';
import { CueStampLayer } from './cue-stamp.jsx';

const { useState, useEffect, useRef, useMemo } = React;

const TALK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "followRange": 340,
  "smoothing": 0.3,
  "charSize": 64,
  "bgColor": "#FFF8EE",
  "micGain": 1.6,
  "thHalf": 0.07,
  "thFull": 0.2,
  "release": 0.12,
  "autoBlink": true,
  "sbGain": 1,
  "sbButtons": true
}/*EDITMODE-END*/;

const { rows: ROWS, cols: COLS } = charConfig;
const GRID = { rows: ROWS, cols: COLS };
// シート: 目開け×口[とじ/中間/開け] = A/B/C, 目閉じ×口[とじ/中間/開け] = D/E/F
const SHEETS = [
  charConfig.sheets.eyesOpen.close,   // A
  charConfig.sheets.eyesOpen.half,    // B
  charConfig.sheets.eyesOpen.open,    // C
  charConfig.sheets.eyesClosed.close, // D
  charConfig.sheets.eyesClosed.half,  // E
  charConfig.sheets.eyesClosed.open,  // F
];
const sheetFor = (eyesClosed, mouth) => SHEETS[(eyesClosed ? 3 : 0) + mouth];
const SRC = (sheet, r, c) => charConfig.src(sheet, r, c);
const BG_OPTIONS = ['#FFF8EE', '#FDEFEF', '#EEF4FB', '#2B2926'];

// 演出キュー: 音（tone は合成音フォールバック / sound にパスがあればそれを再生）と
// スタンプ（reaction）を1つに束ねる。発火経路は 数字キー / 右端ボタン / ?cue= の3つ共通。
const DEFAULT_CUES = [
  { id: 'hello',    label: 'こんにちは', key: '1', tone: 660, stamp: 'こんにちは！', anim: 'pop' },
  { id: 'clap',     label: '拍手',       key: '2', tone: 520, stamp: '👏', anim: 'pop' },
  { id: 'laugh',    label: 'わらい',     key: '3', tone: 720, stamp: '😆', anim: 'rise' },
  { id: 'sweat',    label: 'あせ',       key: '4', tone: 430, stamp: '💦', anim: 'rise' },
  { id: 'anger',    label: 'いかり',     key: '5', tone: 300, stamp: '💢', anim: 'shake' },
  { id: 'sparkle',  label: 'キラキラ',   key: '6', tone: 880, stamp: '✨', anim: 'rise' },
  { id: 'question', label: 'はてな',     key: '7', tone: 600, stamp: '！？', anim: 'pop' },
];

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

// ---- 音声エンジン ----
function makeAudioEngine() {
  const st = {
    ctx: null, micAnalyser: null, micStream: null,
    fileAnalyser: null, fileSourceMade: false, buf: null
  };
  function ctx() {
    if (!st.ctx) st.ctx = new (window.AudioContext || window.webkitAudioContext)();
    return st.ctx;
  }
  function levelOf(analyser) {
    if (!analyser) return 0;
    if (!st.buf || st.buf.length !== analyser.fftSize) st.buf = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(st.buf);
    let sum = 0;
    for (let i = 0; i < st.buf.length; i++) sum += st.buf[i] * st.buf[i];
    return Math.sqrt(sum / st.buf.length);
  }
  return {
    async startMic() {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const c = ctx();
      await c.resume();
      const src = c.createMediaStreamSource(stream);
      const an = c.createAnalyser();
      an.fftSize = 1024;
      src.connect(an);
      st.micStream = stream;
      st.micAnalyser = an;
    },
    stopMic() {
      if (st.micStream) st.micStream.getTracks().forEach((t) => t.stop());
      st.micStream = null;
      st.micAnalyser = null;
    },
    attachAudioEl(el) {
      if (st.fileSourceMade) return;
      const c = ctx();
      const src = c.createMediaElementSource(el);
      const an = c.createAnalyser();
      an.fftSize = 1024;
      src.connect(an);
      an.connect(c.destination);
      st.fileAnalyser = an;
      st.fileSourceMade = true;
    },
    resume() { if (st.ctx) st.ctx.resume(); },
    level() { return Math.max(levelOf(st.micAnalyser), levelOf(st.fileAnalyser)); },
    micOn() { return !!st.micAnalyser; }
  };
}

function App() {
  const [t, setTweak, resetTweaks, themes] = useTweaks(TALK_DEFAULTS);
  const [cell, setCell] = useState({ r: 2, c: 2 });
  const [mouth, setMouth] = useState(0);        // 0:とじ 1:中間 2:開け
  const [blink, setBlink] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [micErr, setMicErr] = useState('');
  const [fileName, setFileName] = useState('');

  const charRef = useRef(null);
  const audioElRef = useRef(null);
  const meterRef = useRef(null);
  const engine = useMemo(() => makeAudioEngine(), []);
  const board = useMemo(() => createSoundboard(), []);
  const stampRef = useRef(null);
  const controller = useMemo(
    () => createCueController(DEFAULT_CUES, (cue) => {
      board.play(cue);
      if (stampRef.current) stampRef.current.pop(cue);
    }),
    [board],
  );
  const [assigned, setAssigned] = useState(() => new Set());
  const target = useRef({ x: 0, y: 0 });
  const current = useRef({ x: 0, y: 0 });
  const env = useRef(0);
  const gestureRef = useRef(null);          // 再生中ジェスチャー { name, start, base }
  const motionRef = useRef(null);           // ジェスチャーの回転/拡縮を直書きするラッパー
  const tweaksRef = useRef(t);
  tweaksRef.current = t;

  // スマホでのページズーム（背景ピンチ・ダブルタップ）を抑止。1本指スクロール等は温存。
  useEffect(() => installMobileHardening(), []);
  // 背景色に合わせて theme-color（ブラウザ chrome / PWA ステータスバー）を追従させる。
  useEffect(() => { applyThemeColor(t.bgColor); }, [t.bgColor]);

  // 演出（サウンドボード）: 全体音量を反映。
  useEffect(() => { board.setMasterGain(t.sbGain); }, [board, t.sbGain]);
  // sound にパス/URL があるキューを先読み（無ければ tone で鳴るので 0 アセットでも可）。
  useEffect(() => {
    controller.cues.forEach((c) => { if (c.sound) board.loadUrl(c.id, c.sound); });
  }, [board, controller]);
  // 数字キーでキュー発火（テキスト入力中・修飾キー併用は無視）。
  useEffect(() => {
    function onKey(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      controller.runByKey(e.key);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [controller]);
  // ?cue=hello,clap で読み込み時に自動発火（OBS の CEF は自動再生が許可されている）。
  useEffect(() => {
    const { cues } = parseCueParam(window.location.search);
    if (!cues.length) return;
    board.resume();
    cues.forEach((id) => controller.run(id));
  }, [board, controller]);

  // マウス追従
  useEffect(() => {
    function onMove(e) {
      const el = charRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height * 0.45;
      const range = tweaksRef.current.followRange;
      target.current.x = clamp((e.clientX - cx) / range, -1, 1);
      target.current.y = clamp((e.clientY - cy) / range, -1, 1);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerdown', onMove);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onMove);
    };
  }, []);

  // メインループ: 追従 + 音声レベル → 口段階
  useEffect(() => {
    let raf;
    let last = { r: 2, c: 2 };
    let lastMouth = 0;
    let lastSwitch = 0;
    function tick(now) {
      const tw = tweaksRef.current;
      current.current.x += (target.current.x - current.current.x) * tw.smoothing;
      current.current.y += (target.current.y - current.current.y) * tw.smoothing;
      let c = clamp(Math.round((current.current.x + 1) / 2 * (COLS - 1)), 0, COLS - 1);
      let r = clamp(Math.round((current.current.y + 1) / 2 * (ROWS - 1)), 0, ROWS - 1);
      // ジェスチャー再生中は向き(r/c)と回転(transform)を一時的に上書き。
      const g = gestureRef.current;
      if (g) {
        const s = sampleGesture(GESTURES[g.name], now - g.start, g.base, GRID);
        if (s) {
          r = s.cell.r; c = s.cell.c;
          if (motionRef.current) motionRef.current.style.transform = gestureTransform(s);
        } else {
          gestureRef.current = null;
          if (motionRef.current) motionRef.current.style.transform = '';
        }
      }
      if (r !== last.r || c !== last.c) { last = { r, c }; setCell(last); }
      const raw = engine.level() * tw.micGain;
      if (raw > env.current) env.current += (raw - env.current) * 0.6;
      else env.current += (raw - env.current) * tw.release;
      if (meterRef.current) {
        meterRef.current.style.width = `${clamp(env.current / 0.4, 0, 1) * 100}%`;
      }
      const lv = env.current;
      const m = lv >= tw.thFull ? 2 : lv >= tw.thHalf ? 1 : 0;
      if (m !== lastMouth && now - lastSwitch > 70) {
        lastMouth = m; lastSwitch = now; setMouth(m);
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [engine]);

  // 自動まばたき（自然なゆらぎ: 不規則な間隔 + 二度瞬き + ゆっくり瞬き）
  useEffect(() => {
    if (!t.autoBlink) { setBlink(false); return; }
    let alive = true;
    let timer;
    const rand = (a, b) => a + Math.random() * (b - a);
    function blinkOnce(dur, after) {
      setBlink(true);
      timer = setTimeout(() => {
        if (!alive) return;
        setBlink(false);
        timer = setTimeout(after, rand(120, 220));
      }, dur);
    }
    function doBlink() {
      if (!alive) return;
      const roll = Math.random();
      if (roll < 0.22) {
        // 二度瞬き（パチパチ）
        blinkOnce(rand(80, 120), () => { if (alive) blinkOnce(rand(70, 110), schedule); });
      } else if (roll < 0.28) {
        // ゆっくり瞬き
        blinkOnce(rand(260, 420), schedule);
      } else {
        blinkOnce(rand(90, 150), schedule);
      }
    }
    function schedule() {
      if (!alive) return;
      const u = Math.random();
      let wait;
      if (u < 0.12) wait = rand(700, 1500);        // たまに間隔が詰まる
      else if (u < 0.82) wait = rand(1800, 4500);  // 通常
      else wait = rand(4500, 9000);                // ぼーっとする間
      timer = setTimeout(doBlink, wait);
    }
    schedule();
    return () => { alive = false; clearTimeout(timer); };
  }, [t.autoBlink]);

  async function toggleMic() {
    setMicErr('');
    if (micOn) { engine.stopMic(); setMicOn(false); return; }
    try {
      await engine.startMic();
      setMicOn(true);
    } catch (e) {
      setMicErr('マイクを使用できません（権限を確認してください）');
    }
  }

  function onFilePick(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const el = audioElRef.current;
    engine.attachAudioEl(el);
    engine.resume();
    el.src = URL.createObjectURL(f);
    el.play().catch(() => {});
    setFileName(f.name);
  }

  // 特定の音（例: こんにちは.mp3）をキューに割り当てる。その場限り（再読込で消える）。
  async function assignCueFile(id, file) {
    const ok = await board.assignFile(id, file);
    if (ok) setAssigned((s) => new Set(s).add(id));
  }

  const allFrames = useMemo(() => {
    const arr = [];
    for (const s of SHEETS) for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) arr.push({ s, r, c });
    return arr;
  }, []);
  const activeSheet = sheetFor(blink, mouth);

  // ジェスチャー演出を再生。再生開始時のライブセルを base に取り、相対キーの基準にする。
  function playGesture(name) {
    if (!GESTURES[name]) return;
    const base = {
      r: clamp(Math.round((current.current.y + 1) / 2 * (ROWS - 1)), 0, ROWS - 1),
      c: clamp(Math.round((current.current.x + 1) / 2 * (COLS - 1)), 0, COLS - 1),
    };
    gestureRef.current = { name, start: performance.now(), base };
  }

  const dark = t.bgColor === '#2B2926';
  const inkColor = dark ? 'rgba(255,248,238,0.85)' : 'rgba(60,48,38,0.8)';
  const subColor = dark ? 'rgba(255,248,238,0.45)' : 'rgba(60,48,38,0.45)';
  const panelBg = dark ? 'rgba(48,45,42,0.92)' : 'rgba(255,255,255,0.88)';
  const lineColor = dark ? 'rgba(255,248,238,0.14)' : 'rgba(60,48,38,0.12)';

  const sizeVmin = t.charSize * 4 / 3;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: t.bgColor,
      overflow: 'hidden', transition: 'background 0.4s ease',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      cursor: 'crosshair', fontFamily: "'Zen Maru Gothic', sans-serif"
    }}>
      <div ref={charRef} className="bob" style={{
        position: 'relative',
        width: `${sizeVmin}vmin`, height: `${sizeVmin}vmin`,
        maxWidth: 1200, maxHeight: 1200,
        userSelect: 'none', touchAction: 'none'
      }}>
        <div ref={motionRef} style={{ position: 'absolute', inset: 0, willChange: 'transform' }}>
          {allFrames.map(({ s, r, c }) => (
            <img key={`${s}${r}${c}`} src={SRC(s, r, c)} alt="" draggable="false" style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%',
              opacity: s === activeSheet && r === cell.r && c === cell.c ? 1 : 0,
              pointerEvents: 'none'
            }}></img>
          ))}
        </div>
      </div>

      {/* リアクション・スタンプの透過オーバーレイ。bob/ジェスチャー変形の影響を受けないようステージ直下に置く。 */}
      <CueStampLayer ref={stampRef} top="14%"></CueStampLayer>

      <div style={{ position: 'absolute', top: 'calc(3.5vh + var(--sat))', left: 0, right: 0, textAlign: 'center', pointerEvents: 'none' }}>
        <div style={{ fontSize: 'clamp(18px, 2.4vmin, 26px)', fontWeight: 700, color: inkColor, letterSpacing: '0.18em' }}>ぐるぐるアバター トーク版</div>
        <div style={{ fontSize: 'clamp(12px, 1.6vmin, 16px)', color: subColor, marginTop: 4, letterSpacing: '0.08em' }}>音声に合わせて口パク・まばたきするよ</div>
        {/* アバター（キャラクター「トマリ」）の著作権表示。原作: ろてじん。
            親は pointerEvents:none なので、リンクだけ auto にしてクリック可能にする。 */}
        <div style={{ fontSize: 'clamp(10px, 1.3vmin, 12px)', color: subColor, marginTop: 4, letterSpacing: '0.04em' }}>
          アバター著作権：<a
            href="https://github.com/rotejin/tomari-guruguru"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: inkColor, textDecoration: 'none', fontWeight: 700, pointerEvents: 'auto' }}
          >ろてじん</a> さん
        </div>
      </div>

      <div style={{
        position: 'absolute', bottom: 'calc(20px + var(--sab))', left: '50%', transform: 'translateX(-50%)',
        display: 'flex', alignItems: 'center', gap: 14,
        background: panelBg, backdropFilter: 'blur(10px)',
        border: `1px solid ${lineColor}`, borderRadius: 18,
        padding: '12px 18px', cursor: 'default',
        boxShadow: '0 6px 24px rgba(60,48,38,0.10)'
      }}>
        <button onClick={toggleMic} style={{
          display: 'flex', alignItems: 'center', gap: 8,
          fontFamily: 'inherit', fontWeight: 700, fontSize: 14,
          color: micOn ? '#fff' : inkColor,
          background: micOn ? '#D96C4F' : 'transparent',
          border: `1.5px solid ${micOn ? '#D96C4F' : lineColor}`,
          borderRadius: 12, padding: '9px 16px', cursor: 'pointer',
          minHeight: 44
        }}>
          <span style={{
            width: 9, height: 9, borderRadius: '50%',
            background: micOn ? '#fff' : '#D96C4F',
            animation: micOn ? 'pulse 1.2s ease-in-out infinite' : 'none'
          }}></span>
          {micOn ? 'マイク停止' : 'マイク開始'}
        </button>

        <label style={{
          display: 'flex', alignItems: 'center', gap: 8,
          fontWeight: 700, fontSize: 14, color: inkColor,
          border: `1.5px solid ${lineColor}`, borderRadius: 12,
          padding: '9px 16px', cursor: 'pointer', minHeight: 44, boxSizing: 'border-box'
        }}>
          ♪ 音声ファイル
          <input type="file" accept="audio/*" onChange={onFilePick} style={{ display: 'none' }}></input>
        </label>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 150 }}>
          <div style={{ fontSize: 11, color: subColor, letterSpacing: '0.06em', display: 'flex', justifyContent: 'space-between' }}>
            <span>音量</span>
            <span>{['とじ', 'はんびらき', 'ぜんかい'][mouth]}</span>
          </div>
          <div style={{ position: 'relative', height: 10, borderRadius: 5, background: lineColor, overflow: 'hidden' }}>
            <div ref={meterRef} style={{
              position: 'absolute', left: 0, top: 0, bottom: 0, width: '0%',
              borderRadius: 5, background: 'linear-gradient(90deg, #8FBC8F, #E8B04B, #D96C4F)'
            }}></div>
            <div style={{ position: 'absolute', top: 0, bottom: 0, width: 2, background: inkColor, opacity: 0.5, left: `${clamp(t.thHalf / 0.4, 0, 1) * 100}%` }}></div>
            <div style={{ position: 'absolute', top: 0, bottom: 0, width: 2, background: inkColor, opacity: 0.5, left: `${clamp(t.thFull / 0.4, 0, 1) * 100}%` }}></div>
          </div>
        </div>
      </div>
      {micErr ? (
        <div style={{ position: 'absolute', bottom: 'calc(92px + var(--sab))', left: '50%', transform: 'translateX(-50%)', color: '#B3261E', fontSize: 13, fontWeight: 700 }}>{micErr}</div>
      ) : null}
      <audio ref={audioElRef} controls style={{
        position: 'absolute', bottom: 'calc(20px + var(--sab))', right: 'calc(20px + var(--sar))', width: 260,
        display: fileName ? 'block' : 'none', cursor: 'default'
      }}></audio>

      {/* 演出ボタン列（右端中央）。配信キャプチャ時は Tweaks の「ボタンを表示」で隠せる。 */}
      {t.sbButtons ? (
        <div style={{
          position: 'absolute', right: 'calc(16px + var(--sar))', top: '50%',
          transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', gap: 8
        }}>
          {controller.cues.map((c) => (
            <button key={c.id} onClick={() => controller.run(c.id)} title={`${c.label}（キー: ${c.key || '-'}）`}
              style={{
                position: 'relative', width: 52, height: 48, fontSize: 22, lineHeight: 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: panelBg, border: `1.5px solid ${lineColor}`, borderRadius: 12,
                cursor: 'pointer', boxShadow: '0 4px 14px rgba(60,48,38,0.08)'
              }}>
              {c.stamp || c.label}
              {c.key ? (
                <span style={{ position: 'absolute', right: 3, bottom: 2, fontSize: 9, fontWeight: 700, color: subColor }}>{c.key}</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      <a href="guruguru.html" style={{
        position: 'absolute', top: 'calc(18px + var(--sat))', left: 'calc(18px + var(--sal))',
        fontSize: 13, fontWeight: 700,
        color: subColor, textDecoration: 'none', letterSpacing: '0.06em'
      }}>← ぐるぐる版</a>

      <TweaksPanel>
        <TweakSection label="口パク"></TweakSection>
        <TweakSlider label="マイク感度" value={t.micGain} min={0.3} max={5} step={0.1}
          onChange={(v) => setTweak('micGain', v)}></TweakSlider>
        <TweakSlider label="しきい値（はんびらき）" value={t.thHalf} min={0.01} max={0.3} step={0.005}
          onChange={(v) => setTweak('thHalf', v)}></TweakSlider>
        <TweakSlider label="しきい値（ぜんかい）" value={t.thFull} min={0.05} max={0.4} step={0.005}
          onChange={(v) => setTweak('thFull', v)}></TweakSlider>
        <TweakSlider label="口を閉じる速さ" value={t.release} min={0.03} max={0.4} step={0.01}
          onChange={(v) => setTweak('release', v)}></TweakSlider>
        <TweakToggle label="自動まばたき" value={t.autoBlink}
          onChange={(v) => setTweak('autoBlink', v)}></TweakToggle>
        <TweakSection label="動き"></TweakSection>
        <TweakSlider label="追従範囲" value={t.followRange} min={120} max={1200} step={10} unit="px"
          onChange={(v) => setTweak('followRange', v)}></TweakSlider>
        <TweakSlider label="追従速度" value={t.smoothing} min={0.04} max={0.5} step={0.01}
          onChange={(v) => setTweak('smoothing', v)}></TweakSlider>
        <TweakSection label="見た目"></TweakSection>
        <TweakSlider label="キャラサイズ" value={t.charSize} min={30} max={92} unit="vmin"
          onChange={(v) => setTweak('charSize', v)}></TweakSlider>
        <TweakColor label="背景色" value={t.bgColor} options={BG_OPTIONS}
          onChange={(v) => setTweak('bgColor', v)}></TweakColor>
        <TweakSection label="ジェスチャー"></TweakSection>
        <div className="twk-presets-row" style={{ flexWrap: 'wrap', marginTop: 2 }}>
          <TweakButton label="回転" onClick={() => playGesture('spin')}></TweakButton>
          <TweakButton label="うなずく" onClick={() => playGesture('nod')}></TweakButton>
          <TweakButton label="No" onClick={() => playGesture('shake')}></TweakButton>
        </div>
        <TweakSection label="演出（サウンドボード）"></TweakSection>
        <TweakSlider label="演出の音量" value={t.sbGain} min={0} max={2} step={0.05}
          onChange={(v) => setTweak('sbGain', v)}></TweakSlider>
        <TweakToggle label="ボタンを表示" value={t.sbButtons}
          onChange={(v) => setTweak('sbButtons', v)}></TweakToggle>
        {controller.cues.map((c) => (
          <label key={c.id} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 8, fontSize: 12, padding: '4px 0', cursor: 'pointer'
          }}>
            <span>{c.stamp} {c.label} {c.key ? `(${c.key})` : ''} {assigned.has(c.id) ? '🔊' : ''}</span>
            <span style={{ opacity: 0.55 }}>音を割当…</span>
            <input type="file" accept="audio/*" style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) assignCueFile(c.id, f); }} />
          </label>
        ))}
        <TweakSection label="テーマ"></TweakSection>
        <TweakPresets themes={themes}></TweakPresets>
        <TweakSection label="リセット"></TweakSection>
        <TweakButton label="設定をデフォルトに戻す" secondary onClick={resetTweaks}></TweakButton>
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App></App>);
