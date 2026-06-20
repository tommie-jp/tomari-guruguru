# iPhone での Kick 配信にアバターを使えるか（調査メモ）

調査日: 2026-06-16

## 質問

iPhone で kick.com にライブ配信するとき、通常のカメラ映像の代わりに
「フロントカメラの映像 ＋ 本プロジェクトのアバター（バックカメラ駆動）」を
合成した映像を使えるか。

## 結論

ユーザーが思い描く **“そのままの形” は不可**。ただし構成を変えれば、
アバター映像を Kick に流すこと自体は可能。

並列リサーチ＋反証検証 4 件をすべて確認（4 件とも confirmed）した結果。

## できない 3 つの壁（検証済み）

### 1. iOS には仮想カメラの仕組みがない

- macOS の OBS Virtual Camera は CoreMediaIO の Camera Extension で実現されるが、
  これは macOS 専用で iOS には存在しない。
- iOS の「KICK - Go Live」アプリは内蔵カメラ（前/後）と画面共有のみが入力で、
  外部・仮想・合成済み映像を受け付けない。
- → 合成映像を「カメラ」として Kick アプリに認識させる方法は存在しない。

### 2. iOS Safari はフロントとバックのカメラを同時に使えない

- WebKit Bug #238492（2022 報告・2024 時点でも未修正）。
- 別カメラを 2 つ目に開くと 1 つ目が止まる/mute される（Bug #179363）。
- → 「フロント＝自撮り表示」＋「バック＝アバターの向き推定」を 1 台の iPhone の
  Web 上で同時に行うのは不可。ネイティブの `AVCaptureMultiCamSession` なら
  2 眼同時が可能だが、Web（getUserMedia）には開放されていない。

### 3. 本プロジェクトはアバターだけを映像として抜き出せない

リポジトリ調査（`guruguru-avatar/src/talk-app.jsx` / `guruguru-avatar/src/app.jsx`）:

- アバターは `<canvas>` ではなく DOM の `<img>` の不透明度切り替えで描画
  （25 方向 × 6 表情のプリレンダ WebP）。
- カメラ映像は MediaPipe FaceLandmarker で顔の向き・口・まばたきを推定する
  ためだけに使用（左上に小さくプレビュー表示）。
- → `canvas.captureStream()` でアバターだけを取り出せず、画面キャプチャでしか
  映像化できない。

## 現実的にできる構成

- **A**: アバター画面を ReplayKit 画面ブロードキャスト → Kick RTMP
  - アバター: 本プロジェクト / 自撮り同時: 不可 / iPhone 単体: 可
  - 補足: Larix Screencaster / HaishinKit 系
- **B**: 2 台＋PRISM の RTMP Overlay で合成 → Kick RTMP
  - アバター: 本プロジェクト / 自撮り同時: 可 / iPhone 単体: 不可（2 台）
  - 補足: 同一 WiFi・音声は 1 ソース
- **C**: PC＋OBS でカメラ＋アバター合成 → Kick RTMP 直送
  - アバター: 本プロジェクト / 自撮り同時: 可 / iPhone 単体: 不可（PC）
  - 補足: 最も安定・自由
- **D**: PRISM 内蔵 VTuber（2D/3D VRM・前面カメラ顔トラッキング）→ Custom RTMP
  - アバター: 別キャラ / 自撮り同時: 可 / iPhone 単体: 可
  - 補足: 単体完結だが guruguru キャラは使えない

おすすめの考え方:

- 「アバターだけを iPhone 単体で Kick 配信」が目的なら → A。
  本アプリを Safari で全画面＋フロントカメラで顔推定し、Larix Screencaster 等で
  画面ごと RTMP 送出。隅のカメラプレビューは非表示にしておく。
- 「自撮り＋アバターを両方見せたい」なら → 1 台では事実上不可。B（2 台）か
  C（PC）が必要。
- キャラにこだわらず手軽さ重視なら → D（PRISM の VTuber 機能が単一アプリで完結。
  本プロジェクトの置き換えになる）。

## 本プロジェクト側の改善余地（任意）

1. アバターを `<canvas>` 描画にも対応させると `canvas.captureStream()` が使え、
   ブラウザ内で単一 MediaStream 化できる（iOS 15.4+ で対応, WebKit #181663）。
2. ブラウザから RTMP は全プラットフォームで不可。配信するなら WebRTC（WHIP）で
   メディアサーバに送って RTMP/HLS に変換する経路が必要。
3. 顔推定はフロントカメラ 1 台で兼用する前提に整理すると、iOS の 2 カメラ制約を
   回避できる。

## 補足

- Kick の RTMP 取り込み先は資料により 2 つ確認: `rtmp://ingest.kick.com/live` と
  `rtmps://...global-contribute.live-video.net:443/app`。正式な値は自分の Kick
  ダッシュボード（Settings > Stream）で確認すること。

### 主な出典

- [Getting started with the KICK - Go Live app](https://help.kick.com/en/articles/15159836-getting-started-with-the-kick-go-live-app)
- [Streaming on Kick from your mobile phone](https://help.kick.com/en/articles/7135289-streaming-on-kick-from-your-mobile-phone)
- [Create camera extensions with Core Media IO (WWDC22)](https://developer.apple.com/videos/play/wwdc2022/10022/)
- [WebKit Bug 238492 (multiple cameras simultaneously)](https://bugs.webkit.org/show_bug.cgi?id=238492)
- [WebKit Bug 179363 (second getUserMedia kills first)](https://bugs.webkit.org/show_bug.cgi?id=179363)
- [WebKit Bug 181663 (canvas.captureStream on iOS)](https://bugs.webkit.org/show_bug.cgi?id=181663)
- [Larix Broadcaster for iOS (Softvelum)](https://softvelum.com/larix/ios/)
- [PRISM - Mobile VTuber](https://medium.com/prismlivestudio/mobile-vtuber-4afaa9d62956)
