// WS 中継の純粋ロジック（producer/consumer の接続管理・素通し）。
//
// ねらい: 中継の「状態と振る舞い」を ws/http から切り離して 1 個のハブに閉じ込め、
//   - standalone の server/relay.mjs（CLI・http(s)・静的配信つき）
//   - Vite dev に同居させる vite-plugin-relay.mjs（HMR と同じ httpServer に相乗り）
// の双方が import して同じ中継挙動を使えるようにする（DRY）。信号の計算はしない。
//
// 設計メモ:
//  - producers/consumers は module グローバルにしない。createRelayHub() のクロージャ state
//    にして「1 ハブ = 1 中継インスタンス」にする（複数サーバ同居・テストで状態が混ざらない）。
//  - handleConnection(ws, role) は req(URL) を受け取らない＝ws/http 非依存で単体テストできる。
//    role 文字列への変換は attachRelay 内の roleOf(req) が担う（境界を 1 か所に寄せる）。
//  - メッセージ規約は docs-camera/11 のとおり: 状態フレーム= JSON 配列、その他= {type,...}。

// req.url の ?role を取り出す純関数（パス非依存。/__relay でも / でも同じ）。不正/未指定は null。
export function roleOf(req) {
  try {
    return new URL(req.url, 'http://localhost').searchParams.get('role');
  } catch {
    return null;
  }
}

// 中継ハブを 1 個作る。producers(tx)/consumers(rx) の集合と、接続 1 本を捌く
// handleConnection(ws, role) を返す。role==='rx' は受信専用、それ以外は producer 扱い。
export function createRelayHub() {
  const producers = new Set(); // tx（送信側ブラウザ）
  const consumers = new Set(); // rx（OBS の CEF）

  function send(sock, obj) {
    if (sock.readyState === 1) sock.send(JSON.stringify(obj));
  }

  function broadcast(set, data) {
    for (const s of set) if (s.readyState === 1) s.send(data);
  }

  // CEF が居る producer に「設定を出して」+「いま CEF が n 台つながっている」を伝える。
  function requestConfigAndNotify(target) {
    send(target, { type: 'need-config' });
    send(target, { type: 'peer', role: 'rx', event: 'connect', count: consumers.size });
  }

  function handleConnection(ws, role) {
    if (role === 'rx') {
      consumers.add(ws);
      // 新しい CEF が来た → 全 producer に config を要求し、接続を通知。
      for (const p of producers) requestConfigAndNotify(p);
      ws.on('close', () => {
        consumers.delete(ws);
        for (const p of producers) {
          send(p, { type: 'peer', role: 'rx', event: 'disconnect', count: consumers.size });
        }
      });
      // consumer は受信専用。万一メッセージが来ても中継しない。
      return;
    }

    // 既定は producer（tx）。
    producers.add(ws);
    // producer が後から繋がったケース: 既に CEF が居れば取りこぼさないよう即要求＋通知。
    if (consumers.size > 0) requestConfigAndNotify(ws);
    // producer の state / config を全 consumer へ素通し。
    ws.on('message', (data, isBinary) => {
      broadcast(consumers, isBinary ? data : data.toString());
    });
    ws.on('close', () => producers.delete(ws));
  }

  // 公開面は実使用メンバーだけ（send/broadcast/requestConfigAndNotify はクロージャ内ローカルに留める）。
  return { producers, consumers, handleConnection };
}

// 既存の WebSocketServer に中継ハブを結線する。standalone relay.mjs と Vite プラグインの共通入口。
// connection ごとに roleOf(req) で role を確定してから handleConnection へ渡す。
export function attachRelay(wss, hub = createRelayHub()) {
  wss.on('connection', (ws, req) => hub.handleConnection(ws, roleOf(req)));
  return hub;
}
