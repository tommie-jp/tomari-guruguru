# URL パラメータ一覧

camera 版（`index.html`）が起動時に解析する URL クエリの早見表。これらは**起動時に一度だけ**
読まれ、途中変更は効かない（変えたら再読込）。`guruguru.html` / `talk.html` / `tracking.html`
は URL パラメータを読まない（camera 版専用）。

真偽フラグ（`tx` / `rx` / `obs`）は値なし・`1` / `true` / `yes` / `on` を「有効」とみなす
（`tx` / `rx` は `ws` も可）。`obs` だけは `0` / `false` で明示的に「無効」にできる。

## 早見表

| パラメータ | 値 | 意味 | 既定 |
| --- | --- | --- | --- |
| `?tx` | （フラグ）/ `=ws` | 中継の**送信側**（カメラ＋推論＋設定 UI）。[08](08-WS中継の接続手順.md) | local |
| `?rx` | （フラグ）/ `=ws` | 中継の**受信側**（カメラ無し・受信描画。OBS の CEF 用）。`obs` 既定 ON | local |
| `?relay` | `ws(s)://host:port` | 中継サーバの WebSocket URL を明示 | 同ホストの `:8787` |
| `?obs` | （フラグ）/ `1` / `0` | **ステージモード**（背景透過＋UI 非表示）。三状態。[04](04-OBSでライブ配信.md) | 未指定なら rx のとき ON |
| `?shadow` | `0`〜`3`（値なし=2） | アバターに影（透過背景で輪郭を立てる） | `0`（無し） |
| `?avatar` | `<id>` | 表示アバターを固定（OBS シーン用）。セレクタより優先。[12](12-アバターの追加.md) | 保存値／既定 |
| `?camera` | `<ラベル>` / `<番号>` | 使うカメラを固定（OBS シーン用）。[15](15-カメラ切り替え.md) | 保存値／既定 |

## グループ別の説明

### 中継（tx / rx / relay）

PC のブラウザや iPhone で推論して状態を送り（`tx`）、OBS の CEF が受信して描画する（`rx`）構成。

- `?tx` … producer。カメラ＋推論を動かし状態フレームを送信。設定 UI もここ。
- `?rx` … consumer。カメラを起動せず、受信した動きだけで描画。**OBS 用なので既定で透過＋UI 非表示**。
- `?relay=<url>` … 中継先を明示。省略時は「ページと同じホストの `:8787`」。ページが https なら
  `wss`、http なら `ws`（mixed-content 回避）。

`tx` と `rx` を同時指定したら `tx` を優先。詳細・接続手順は [08-WS中継の接続手順.md](08-WS中継の接続手順.md)。

### 表示・OBS（obs / shadow）

- `?obs` … 背景を透過し UI を全部隠す「ステージモード」。**三状態**で扱う:
  - 未指定 → `rx` のときだけ ON（OBS の CEF 受信を想定）、それ以外は OFF。
  - `?obs` / `?obs=1` → 常時 ON（`rx` でないローカル直 OBS でも透過したいとき）。
  - `?obs=0` → 常時 OFF（`rx` をブラウザのタブでデバッグするとき）。
- `?shadow=n` … `0`〜`3` の影レベル（大きいほど濃い）。値なし `?shadow` は `2`。

仕組みと運用は [04-OBSでライブ配信.md](04-OBSでライブ配信.md) / [05-OBSにカメラを触らせない代替案.md](05-OBSにカメラを触らせない代替案.md)。

### 選択（avatar / camera）

OBS のシーンごとに「どのアバター・どのカメラ」を固定したいとき用。どちらも**セレクタより URL が優先**で、
指定中は Tweaks パネルに「URL固定」と表示される。

- `?avatar=<id>` … `id` は `src/character-config.js` の `avatars`（例 `01-tomari`）。未知・未指定は保存値／既定。
- `?camera=<ラベル|番号>` … ラベルは部分一致（大小無視・完全一致優先）。番号は N 番目（0 始まり・
  順序が不定なのでワンショット用、固定はラベル推奨）。優先は **URL > 保存値 > 既定**。詳細は
  [15-カメラ切り替え.md](15-カメラ切り替え.md)。

## 組み合わせ例

```text
# OBS のブラウザソース（受信側・本番）。?rx だけで透過オーバーレイ
https://<host>:5173/index.html?rx

# rx をブラウザのタブで動作確認（透過を切って UI を見る）
http://localhost:5173/index.html?rx&obs=0

# 送信側（PC で顔を動かす）
http://localhost:5173/index.html?tx

# iPhone を送信側に（カメラは HTTPS 必須）
https://<host>:5173/index.html?tx

# ローカル直 OBS（カメラを CEF で動かす・中継なし）。透過は ?obs=1 を明示
https://<host>:5173/index.html?obs=1&shadow=2

# OBS シーン固定（受信側でアバターとカメラを URL 指定）
https://<host>:5173/index.html?rx&avatar=01-tomari&camera=Logitech

# 中継サーバが別ホスト
https://<host>:5173/index.html?rx&relay=wss://relay-host:8787
```

## 注意

- ラベルやアバター id に空白・記号が入るときは URL エンコードする（`?camera=Front%20Camera`）。
- 各パラメータは独立で、同時指定しても衝突しない（`?rx&obs=0&avatar=…&camera=…` など）。
- 解析の実体は純関数: `src/relay-mode.js`（tx/rx/relay）・`src/obs-mode.js`（obs/shadow）・
  `src/camera-config.js`（camera）・`src/camera-app.jsx` 内 `parseAvatarParam`（avatar）。いずれも単体テスト付き。
