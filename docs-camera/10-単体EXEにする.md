# 単体 EXE にする（Node 不要で配る）

配布先に Node.js を入れたくないとき、中継 + 静的配信を `guruguru-relay.exe` 1つに固めて、
`dist-local\`（配信物）と `start.bat` を添えて配る。仕組みは
**Node SEA（Single Executable Applications）**＋ **postject**。`ws` は esbuild で exe に同梱し、
`dist-local`（camera.html / assets / mediapipe）は exe の隣に置いて `--web-root` で配る。

通常の運用（Node を入れて使う）は [09-Windowsで動かす.md](09-Windowsで動かす.md) を参照。EXE 化は
「Node を入れない配布」をしたいときだけでよい。

## 前提

- **ビルドは Windows 上で行う**（Windows の `node.exe` に blob を注入するため、別 OS では作れない）。
- Node.js は **20 以上**（SEA 対応版）。`node -v` で確認。

## かんたんビルド

`guruguru-avatar\` フォルダで PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File windows\build-exe.ps1
```

これで次が `dist-exe\` に揃う:

- `guruguru-relay.exe` … 中継 + 静的配信（Node 同梱・単体動作）
- `dist-local\` … 配信物（camera.html ほか）
- `start.bat` … 起動用（exe を起動 → 送信側ブラウザを開く → rx URL 表示）

`dist-exe\` を丸ごとコピーして配布し、配布先では **`start.bat` をダブルクリック**するだけ。

## WSL2(Ubuntu) から作る・試す場合

WSL2 は **interop で Windows の `.exe` を実行できる**ので、Windows を別途操作せずに
WSL のシェルだけで「ビルド → 実行確認」までできる（実証済み）。土台に **Windows 版
`node.exe`** を使う点だけ守ればよい（`/mnt/c/Program Files/nodejs/node.exe`）。

```bash
WINNODE="/mnt/c/Program Files/nodejs/node.exe"
FUSE=NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
npm run build:local && npm run build:sea-blob
cp "$WINNODE" dist-exe/guruguru-relay.exe
chmod u+rw dist-exe/guruguru-relay.exe          # /mnt/c の node.exe は読取専用なので付与
npx postject dist-exe/guruguru-relay.exe NODE_SEA_BLOB dist-exe/relay.blob --sentinel-fuse "$FUSE"
# 実行（interop で Windows プロセスになる）。web-root は Windows パスで渡す:
./dist-exe/guruguru-relay.exe --web-root "$(wslpath -w "$PWD/dist-local")" --port 8787 --host 127.0.0.1
```

動作確認は **Windows 側から**行う（WSL が NAT ネットワークだと WSL 側からは Windows の
`127.0.0.1` に届かないため）。例: `powershell.exe -Command "(iwr -UseBasicParsing
http://127.0.0.1:8787/camera.html).StatusCode"` が `200`。停止は
`taskkill.exe /F /IM guruguru-relay.exe`。

## 中身（手動でやる場合）

`build-exe.ps1` がやっていることは以下と同じ:

```powershell
# 1. 静的配信物
npm run build:local
# 2. サーバを単一CJSにバンドル(ws 同梱) → SEA blob を生成
npm run build:sea-blob
# 3. node.exe を複製
Copy-Item (Get-Command node).Source dist-exe\guruguru-relay.exe -Force
# 4. blob を注入
npx postject dist-exe\guruguru-relay.exe NODE_SEA_BLOB dist-exe\relay.blob `
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
```

`build:sea-blob` は `esbuild` で `server/relay.mjs` を CJS に束ね（`server/sea-config.json` 参照）、
`node --experimental-sea-config` で blob 化する。Node 組み込み（http/https/fs/path）は外部のまま、
`ws` だけが exe に入る。

## 起動と接続

`start.bat` は内部で次を実行する（ポートを変えたいときはここを編集）:

```bat
guruguru-relay.exe --web-root dist-local --port 8787 --host 127.0.0.1
```

- 送信側(tx): `http://127.0.0.1:8787/?tx`（Edge/Chrome）
- OBS 受信側(rx): `http://127.0.0.1:8787/?rx&obs=1`（OBS のブラウザソース）

LAN の別端末からも繋ぐなら `--host 0.0.0.0`（要ファイアウォール許可）。

## 注意

- **SmartScreen 警告**: blob を注入すると Node の署名が外れるため、初回起動で「発行元不明」が
  出ることがある。「詳細情報」→「実行」で起動できる（社内/個人配布なら通常これで十分）。
- **exe サイズ**: Node 本体を含むため数十 MB になる。これは SEA の仕様。
- **更新時**: コードや配信物を変えたら `build-exe.ps1` を再実行して `dist-exe\` を作り直す。
- **postject が無い**: 初回は `npx` が自動取得する。社内ネット制限がある場合は
  `npm i -g postject` で事前に入れておく。
