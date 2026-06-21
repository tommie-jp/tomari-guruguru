// 中継サーバ(server/relay.mjs)につなぐ最小 WebSocket クライアント。
//
// docs-camera/05 のメッセージ規約:
//   - 状態フレーム: JSON 配列 [...]（state-codec の encode/decode 済み）
//   - それ以外: JSON オブジェクト { type, ... }
//       config        : { type:'config', tweaks }     producer→consumer（設定配布）
//       cue           : { type:'cue', id }             producer→consumer（演出トリガ転送）
//       need-config   : { type:'need-config' }         server→producer（CEF 接続時の要求）
//       peer          : { type:'peer', ... }           server→producer（CEF 接続/切断の通知）
//
// 切断時は指数バックオフで自動再接続する。送信は readyState を見て握りつぶす
// （未接続時の例外を出さない＝呼び出し側は気にしなくてよい）。

const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8000;

/**
 * @param {Object} o
 * @param {string} o.url      ws(s):// の中継 URL
 * @param {'tx'|'rx'} o.role  役割（サーバが producer/consumer を振り分ける）
 * @param {(frame:Array<number>)=>void} [o.onState]    状態フレーム受信（rx 用）
 * @param {(tweaks:object)=>void} [o.onConfig]         config 受信（rx 用）
 * @param {(id:string)=>void} [o.onCue]                cue 受信（rx 用・演出トリガ）
 * @param {()=>void} [o.onNeedConfig]                  config 要求受信（tx 用）
 * @param {(msg:object)=>void} [o.onPeer]              接続通知受信（tx 用）
 * @param {(s:{connected:boolean})=>void} [o.onStatus] 自身の接続状態変化
 * @param {(url:string)=>WebSocket} [o.makeSocket]     テスト用の差し替え口
 * @returns {{ sendState:Function, sendConfig:Function, sendCue:(id:string)=>void, close:()=>void }}
 */
export function createRelayClient(o) {
  const {
    url, role, onState, onConfig, onCue, onNeedConfig, onPeer, onStatus,
    makeSocket = (u) => new WebSocket(u),
  } = o;

  const fullUrl = `${url}${url.includes('?') ? '&' : '?'}role=${encodeURIComponent(role)}`;
  let ws = null;
  let backoff = INITIAL_BACKOFF_MS;
  let reconnectTimer = 0;
  let closed = false; // 明示 close() 後は再接続しない

  function connect() {
    ws = makeSocket(fullUrl);

    ws.onopen = () => {
      backoff = INITIAL_BACKOFF_MS;
      onStatus?.({ connected: true });
    };

    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return; // 壊れたメッセージは無視
      }
      if (Array.isArray(msg)) {
        onState?.(msg);
        return;
      }
      switch (msg && msg.type) {
        case 'config': onConfig?.(msg.tweaks); break;
        case 'cue': onCue?.(msg.id); break;
        case 'need-config': onNeedConfig?.(); break;
        case 'peer': onPeer?.(msg); break;
        default: break;
      }
    };

    ws.onerror = () => {
      // onclose に任せる（onerror 後はほぼ必ず close する）。
      try { ws.close(); } catch { /* noop */ }
    };

    ws.onclose = () => {
      onStatus?.({ connected: false });
      if (closed) return;
      reconnectTimer = setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    };
  }

  connect();

  function rawSend(payload) {
    if (ws && ws.readyState === 1) {
      try { ws.send(payload); } catch { /* 送信失敗は次フレームで回復 */ }
    }
  }

  return {
    sendState(frame) { rawSend(JSON.stringify(frame)); },
    sendConfig(tweaks) { rawSend(JSON.stringify({ type: 'config', tweaks })); },
    sendCue(id) { rawSend(JSON.stringify({ type: 'cue', id })); },
    close() {
      closed = true;
      clearTimeout(reconnectTimer);
      try { ws?.close(); } catch { /* noop */ }
    },
  };
}
