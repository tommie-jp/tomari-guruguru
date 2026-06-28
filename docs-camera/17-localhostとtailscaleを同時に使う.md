# localhost と tailscale を同時に使う（doStartDev の --both）

`./doStartDev.sh` の既定モード **both** の解説。1 回の起動で

- PC（同一マシン）から `http://localhost:5173`（平文・手軽・HMR が効く）
- iPhone / OBS など別端末から `https://<FQDN>:5174`（TLS・secure context）

を**同時に**使えるようにする。`-t`（tailscale 直接 HTTPS）と `-l`（localhost のみ）を起動ごとに
使い分ける必要がなくなった。

## 結論（URL 早見表）

| 用途 | URL | プロトコル | 備考 |
| ---- | ---- | ---- | ---- |
| PC | `http://localhost:5173/` | http | vite 本体に直結。HMR が効く |
| iPhone (tx) | `https://<FQDN>:5174/index.html?tx` | https | アプリ内 QR が指す。カメラ可（secure context） |
| OBS (rx) | `https://<FQDN>:5174/index.html?rx` | https | 同上 |

`<FQDN>` は tailscale から動的取得（例 `wsl40.taild830ae.ts.net`）。**iPhone は手入力せず
アプリ内の QR を読む**のが確実（QR は自動で `:5174` を指す）。

## 仕組み

vite dev は 1 プロセス＝1 プロトコルなので、同じポートで http と https を同時に喋れない。
そこで **vite は http のまま**にし、その隣に **TLS リバースプロキシ**を別ポートで立てて
vite へ素通しする。

```text
PC (同一マシン) ──http──> 0.0.0.0:5173  vite (http)
                              │  └─ /__relay 中継1本（loopback 限定・RELAY_EXPOSE 不要）
iPhone(tx) ─https─┐           │
OBS(rx)    ─https─┴─> <tailscale IP>:5174  dev-tls-proxy ──http/ws──> 127.0.0.1:5173
                     (tailscale 証明書で TLS 終端)         ＝ 同じ vite・同じ中継 hub
```

- tx（iPhone）と rx（OBS）はどちらもプロキシ経由で**同じ vite の同じ中継**に繋がるので出会える。
- プロキシは `127.0.0.1` から中継へ繋ぐため、中継は loopback 判定で受理される
  ＝ `RELAY_EXPOSE` 不要（tailnet へ生の WS を晒さない。`-t` 直接 HTTPS より安全）。

### なぜポートが 5173 と 5174 に分かれるのか

- WSL では Windows 側 Chrome が `localhost` で届くために vite を **`0.0.0.0:5173`** にバインドする必要がある
  （`127.0.0.1` 専用バインドは Windows から不達。`vite.fork.js` が WSL で `server.host=true` にするのはこのため）。
- `0.0.0.0:5173` は tailscale IP の `:5173` も占有するので、プロキシは**同じ 5173 を使えない**。
  そのため `PROXY_PORT = PORT + 1 = 5174` に立てる。

### IPv4 / IPv6 の両対応

tailscale は v4（`100.x`）と v6（`fd7a:…`）の両方を持ち、iPhone がどちらを選ぶかは
Happy Eyeballs 次第。プロキシは**両アドレスに bind** する（片方が bind 失敗しても他方が
生きていれば継続）。

## 使い方

```bash
./doStartDev.sh            # 既定 = both（localhost http と tailscale https を同時）
./doStartDev.sh -l         # localhost 専用 http に固定（--localhost / --no-tls / NO_TLS=1）
./doStartDev.sh -t         # 旧来モード: vite 自身が直接 HTTPS（localhost http は使えない）
./doStartDev.sh --both     # both を明示（-2 / --dual でも可）
PORT=5180 ./doStartDev.sh  # vite を別ポートに（プロキシは PORT+1）
DRY_RUN=1 ./doStartDev.sh  # ポートを解放するだけで起動しない
```

`-l` / `-t` / `--both` は同時指定不可（衝突するとエラー）。`Ctrl+C` で vite とプロキシの両方が止まる。

### tailscale が使えないとき

FQDN / IP / 証明書のいずれかが取れない場合は、警告のうえ **localhost 専用 http に自動降格**する
（プロキシを立てず `npm run dev` だけ）。PC 開発は必ず動く。別端末から繋ぎたいときは tailscale を
起動して再実行する。

## 構成ファイル

- `server/dev-tls-proxy.mjs` — 依存ゼロ（Node コアのみ）の TLS リバースプロキシ。HTTP も
  WebSocket（HMR `/`・中継 `/__relay`）も透過転送する。`CERT` / `KEY` / `BIND_IPS` /
  `LISTEN_PORT`（既定 5174）/ `TARGET_PORT`（既定 5173）を環境変数で受ける。
- `vite.fork.js` — `VITE_ALLOWED_HOST=<FQDN>` のとき `server.allowedHosts` にその FQDN を足す。
  http の vite はプロキシ経由の FQDN 付き Host を既定ではブロックする（"Blocked request"）ための対策。
- `doStartDev.sh` — FQDN と self IP（v4/v6）を tailscale から動的取得し、証明書を解決（無ければ
  `tailscale cert` で発行）してプロキシを起動。vite とプロキシの 2 プロセスを管理し、終了時に両方を畳む。

## トラブルシュート

### iPhone で「セキュリティ保護された接続を確立できなかった」

`:5174`（https プロキシ）ではなく **`:5173`（今は http の vite）に https で当たっている**。
`:5173` に TLS で繋ぐと「wrong version number」でハンドシェイクが失敗する。
→ **アプリ内 QR（`:5174`）から開く**。`:5173` は PC 専用（http）と覚える。

### PC の `http://localhost:5173` が `ERR_CONNECTION_RESET` / 開けない

vite が `0.0.0.0` でなく `127.0.0.1` にバインドされていると、WSL では Windows Chrome から届かない。
`ss -ltn | grep :5173` で `*:5173` か `0.0.0.0:5173`（＝Windows 可）になっているか確認する。
`127.0.0.1:5173` だけなら不達。

### ポートが使用中で起動しない

`doStartDev.sh` は起動前に 5173 / 5174 のリスナーを解放するが、残る場合は
`fuser -k 5173/tcp 5174/tcp` を手で実行する。

## セキュリティ

中継 `/__relay` は無認証 WS。both モードでは loopback 限定のままなので tailnet には生で晒さない
（プロキシ経由＝TLS 終端のみ）。ただし TLS を剥いだ先（vite 本体）は `0.0.0.0:5173` で平文配信される
ため、運用は tailscale など ACL で閉じた私設網に限る。公開インターネットへは晒さないこと。

## 検証済みの挙動

- PC `http://localhost:5173` → 200（Windows Chrome から到達）
- iPhone/OBS `https://<FQDN>:5174`（v4・v6 とも）→ 200・"Blocked request" にならない
- アプリ内 QR が `https://<FQDN>:5174/...?tx` をエンコード
- iPhone(tx) → OBS(rx) のポーズ同調（同じ中継 hub）
- 非 loopback からの vite 直叩き `/__relay` は拒否（プロキシ経由のみ受理）
- `Ctrl+C` 後に孤児リスナーが残らない
- tailscale を落とすと localhost 専用 http に降格
