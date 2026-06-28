// サウンドボード（Web Audio）。キューに対応する短い音を再生する。
//
// 設計メモ:
//  - 音源ファイル（URL / ローカルファイル）を AudioBuffer として読み込んで再生する。
//  - ファイルが無いキューは tone（合成チャイム）でフォールバックするので、
//    アセットが 1 個も無くてもボタンを押せば音が出る → すぐ動作確認できる。
//  - 口パク連動は今回は対象外（後回し）。よって Analyser は挟まず destination 直結。
//    将来連動するときは destination の手前に AnalyserNode を 1 段入れるだけでよい。
//
// 自動再生ポリシー対策: 最初のユーザー操作（クリック/キー）で resume() が呼ばれる前提。
// OBS の CEF は自動再生が許可されているので ?cue= 自動発火でも鳴る。

export function createSoundboard() {
  const st = {
    ctx: null,
    out: null, // master GainNode（全体音量）
    buffers: new Map(), // id -> AudioBuffer
    master: 1,
    unlocked: false, // iOS 無音バッファによるアンロック済みか
  };

  function ctx() {
    if (!st.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      st.ctx = new AC();
      st.out = st.ctx.createGain();
      st.out.gain.value = st.master;
      st.out.connect(st.ctx.destination);
    }
    return st.ctx;
  }

  function resume() {
    // 戻り値は Promise だが、呼び出し側は待たなくてよい（fire-and-forget）。
    if (st.ctx && st.ctx.state === 'suspended') return st.ctx.resume();
    return Promise.resolve();
  }

  // iOS(WebKit) の自動再生制限対策。必ず「ユーザー操作のハンドラ内」で呼ぶこと。
  // AudioContext を（無ければ操作内で）作成→resume し、無音バッファを1度鳴らして
  // 完全にアンロックする。以降は play() が普通に鳴る。毎操作で呼んでも安全（軽い）。
  function unlock() {
    const c = ctx();
    if (c.state === 'suspended') c.resume();
    if (st.unlocked) return;
    st.unlocked = true;
    try {
      const src = c.createBufferSource();
      src.buffer = c.createBuffer(1, 1, 22050);
      src.connect(st.out);
      src.start(0);
    } catch { /* noop */ }
  }

  function setMasterGain(g) {
    st.master = Number.isFinite(g) && g >= 0 ? g : 1;
    if (st.out) st.out.gain.value = st.master;
  }

  async function decode(arrayBuffer) {
    const c = ctx();
    // decodeAudioData は環境により callback 版しか無いことがあるので両対応。
    return await new Promise((resolve, reject) => {
      const p = c.decodeAudioData(arrayBuffer, resolve, reject);
      if (p && typeof p.then === 'function') p.then(resolve, reject);
    });
  }

  // URL から AudioBuffer を読み込む。失敗時は false（呼び出し側は tone へフォールバック）。
  async function loadUrl(id, url) {
    try {
      const res = await fetch(url);
      if (!res.ok) return false;
      const buffer = await decode(await res.arrayBuffer());
      st.buffers.set(id, buffer);
      return true;
    } catch {
      return false;
    }
  }

  // input[type=file] で選んだファイルをキューに割り当てる（その場限り・永続化しない）。
  async function assignFile(id, file) {
    try {
      const buffer = await decode(await file.arrayBuffer());
      st.buffers.set(id, buffer);
      return true;
    } catch {
      return false;
    }
  }

  function playBuffer(buffer, gain) {
    const c = ctx();
    const src = c.createBufferSource();
    src.buffer = buffer;
    const g = c.createGain();
    g.gain.value = gain;
    src.connect(g);
    g.connect(st.out);
    src.start();
  }

  // tone フォールバック: 「ポンッ」と鳴る 2 音の短いチャイム。
  function playTone(freq, gain) {
    const c = ctx();
    const now = c.currentTime;
    const vol = 0.22 * gain;
    [
      { f: freq, at: 0 },
      { f: freq * 1.5, at: 0.1 },
    ].forEach(({ f, at }) => {
      const osc = c.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const eg = c.createGain();
      osc.connect(eg);
      eg.connect(st.out);
      const t0 = now + at;
      eg.gain.setValueAtTime(0.0001, t0);
      eg.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
      eg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.13);
      osc.start(t0);
      osc.stop(t0 + 0.16);
    });
  }

  // キューを鳴らす。読み込み済みバッファがあればそれを、無ければ tone を使う。
  function play(cue) {
    if (!cue) return;
    ctx();
    resume();
    const gain = Number.isFinite(cue.gain) && cue.gain >= 0 ? cue.gain : 1;
    const buffer = st.buffers.get(cue.id);
    if (buffer) playBuffer(buffer, gain);
    else if (cue.tone) playTone(cue.tone, gain);
  }

  // 割り当て済みバッファを外す（効果音を既定＝tone に戻すとき）。
  function unassign(id) {
    st.buffers.delete(id);
  }

  return {
    play,
    loadUrl,
    assignFile,
    unassign,
    resume,
    unlock,
    setMasterGain,
    has: (id) => st.buffers.has(id),
  };
}
