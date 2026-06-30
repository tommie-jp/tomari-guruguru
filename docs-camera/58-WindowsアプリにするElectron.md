# Windows アプリ（.exe）にする（Electron + electron-builder）

スマホ(tx)＋PC(rx)の「PC 側」を 1 つの Windows アプリにまとめて配る方法。Electron で
内蔵 HTTP サーバ（中継 + 静的配信）を起動し、ウィンドウに既存の `index.html?tx` を開く。
配布先には Node.js も Bun も不要。`.exe`（インストーラ or ポータブル）をダブルクリックするだけ。

`53-単体EXEにする.md` の Bun バイナリ版は「中継サーバだけ」を配るのに対し、こちらは
**カメラ UI 付きのアプリ窓ごと**配る。OBS は同一機の透過 URL を見るだけでよい。

通常運用（開発機で Node を入れて使う）は `14-Windowsで動かす.md` を参照。
Electron 化は「配布先にランタイムを入れずにアプリとして配る」ときに使う。

## 前提

- ビルドは **Windows でも WSL でも**できる（electron-builder が NSIS / portable を生成）。
- Node.js は 20.19+ または 22.12+（22 LTS 推奨）。
- 先に `dist-local/`（base=/ の配信物）を作る。`dist:win*` スクリプトが
  `npm run build:local` を内部で呼ぶので、手動ビルドは不要。
- アイコン `build/icon.ico` を 1 度だけ生成しておく（後述）。`build/` は
  electron-builder の `buildResources` ディレクトリでもある。

## package.json への追加

`guruguru-avatar/package.json` に次を足す。`main` と `type:module` は既存。

- `devDependencies` に `electron-builder` を 1 行追加する。
- `scripts` に 3 つ追加する。
- トップレベルに `build` ブロックを追加する。

具体的な値は本リポジトリの `package.json` に反映済み（同梱する `files` は
main プロセスの import 閉包＝6 ファイル + `package.json` だけ。`ws` は本番依存なので
electron-builder が自動で asar 内へ同梱する。`dist-local/` は `extraResources` で
asar の外＝`resources/dist-local` に置き、内蔵サーバが実ファイルとして配信する）。

## アイコンを作る

`public/pwa-512x512.png`（512×512 RGBA・透過あり）を `.ico` に変換する。
`pwa-maskable-512x512.png` は RGB で透過が無く safe-zone 余白付きなので使わない。
`build/` は無ければ作る。

```bash
mkdir -p build
# ImageMagick v6（convert）
convert public/pwa-512x512.png -background none \
  -define icon:auto-resize=256,128,64,48,32,16 \
  build/icon.ico
```

ImageMagick v7 が入っている環境なら `convert` を `magick` に置き換える。

```bash
mkdir -p build
magick public/pwa-512x512.png -background none \
  -define icon:auto-resize=256,128,64,48,32,16 \
  build/icon.ico
```

## ビルドする

`guruguru-avatar/` で次のいずれか。各スクリプトが先に `npm run build:local` を走らせる。

```bash
npm run dist:win          # NSIS インストーラ + ポータブルの両方
npm run dist:win:nsis     # NSIS インストーラだけ
npm run dist:win:portable # ポータブル .exe だけ
```

初回は `npm install` で `electron` と `electron-builder` を入れておく。
出力は `dist-electron/` に揃う。

- `Guruguru Avatar Setup <version>.exe` … NSIS インストーラ（インストール先変更可・
  デスクトップショートカット作成）
- `Guruguru Avatar-<version>-portable.exe` … ポータブル（インストール不要・単体起動）

## 起動と接続

アプリを起動すると内蔵サーバが `http://127.0.0.1:5179` で立ち上がり、
ウィンドウに `index.html?tx`（PC カメラ + QR + UI）が開く。中継は 127.0.0.1 限定。

- ウィンドウ内の「カメラ源トグル」で **PC カメラ / スマホ** を切り替える。
- OBS 受信側(rx): ブラウザソースに `http://127.0.0.1:5179/index.html?rx&obs` を入れる
  （透過 + UI 非表示）。
- ポート 5179 は vite(5173) / standalone relay(8787) と重複しない既定。

## スマホ(tx)を使う（Tailscale）

スマホのカメラを tx に使うには HTTPS が要る。Tailscale を入れておくと、アプリ起動時に
FQDN を検出して QR をその https に向ける。TLS 終端は **この PC で 1 度だけ**次を実行する
（`<port>` は 5179）。

```bash
tailscale serve --bg --https=443 http://127.0.0.1:5179
```

検出できないときは QR は loopback の http のままになる（同一機ブラウザでの tx 用）。
詳しくは `17-localhostとtailscaleを同時に使う.md` を参照。

## 注意

- **SmartScreen 警告**: コード署名をしていないため、初回起動で「発行元不明」が出る。
  「詳細情報」→「実行」で起動できる（社内 / 個人配布なら通常これで十分）。
- **getUserMedia**: アプリは内蔵サーバの自オリジン（`http://127.0.0.1:5179`）にだけ
  カメラ / マイク許可を出す。`file://` では secure context にならないため内蔵 HTTP を使う。
- **更新時**: コードや配信物を変えたら `npm run dist:win` を再実行して `dist-electron/`
  を作り直す。`dist-local/` も `build:local` で更新される。
- **単一インスタンス**: 2 個目を起動しても既存ウィンドウが前面化するだけ（ポート二重
  bind を防ぐ）。
