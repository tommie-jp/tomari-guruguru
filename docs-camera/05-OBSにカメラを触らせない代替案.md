# OBS にカメラを触らせない代替案（別ブラウザ + WebSocket 中継）

OBS 内蔵ブラウザ(CEF)にカメラを使わせる代わりに、**顔トラッキングを通常の Chrome で動かし、
推定した向き(signals)を OBS 側のページへ送る**構成の構想メモ。これが実現すると
`--enable-media-stream`（[04-OBSでライブ配信.md](04-OBSでライブ配信.md)）が不要になる。

ステータス: **構想のみ（未実装）**。現状は `--enable-media-stream` 方式で動作確認済み。

## 動機

- OBS の CEF はカメラ周りの制約が多い（既定でブロック、フラグ必須、API も限定的）。
- 通常の Chrome ならカメラ・MediaPipe が速く確実に動く。
- トラッキングを Chrome に出し、OBS 側は描画だけにすれば CEF の制約を回避できる。

## 重要: 通信できる/できないの境界

ページ間通信の機構は「同じブラウザの中」しか繋がらないものが多い。

- 同じ Chrome の2タブ（同一オリジン）
  → BroadcastChannel / localStorage の storage イベント / SharedWorker が**サーバ不要**で使える。
- **別ブラウザ間（Chrome ↔ OBS の CEF）** ← 今回はこれ
  → 上記は**全て使えない**（storage も BroadcastChannel もプロセスを跨がない）。
  → オリジンが同じ（どちらも `localhost:5173`）でもブラウザごとに隔離される。
  → **ネットワーク経由の中継が必須**。

## 定番構成: ローカル WebSocket 中継

```text
[Chrome] カメラ + MediaPipe → signals を WS送信
                │
                ▼
   [ローカル WebSocket サーバ]
                │
                ▼
[OBS 内ブラウザ] signals 受信 → アバターに適用（カメラ不要）
```

- 送信側（Chrome）: 既存のトラッキングをそのまま使い、`deriveFaceSignals` が作る小さな
  signals（yaw/pitch/roll/mouth/eyes/pos/scale 等）を WS で投げる。
- 受信側（OBS ページ）: 新モード（例 `camera.html?recv=ws`）で WS を購読し、受け取った
  signals を**既存の ref 群へそのまま流し込む**（カメラ・推論を起動しない）。
- WS サーバは Node の `ws` で十数行。Vite の dev サーバにミドルウェアとして同居も可能。

このプロジェクトは元々 `deriveFaceSignals`（信号）と描画を分離しているので、
signals をそのまま WS のペイロードにできる＝相性が良い。

## 他の選択肢

- WebRTC DataChannel: P2P で低遅延だが、結局シグナリング用サーバが要り複雑。localhost では過剰。
- SSE / HTTP ポーリング: Chrome が POST → OBS が EventSource で受信。Vite ミドルウェアだけで
  作れるが、高頻度ストリーミングは WS の方が素直。
- localhost なら **WebSocket が最良**（双方向・低遅延・実装が軽い）。

## トレードオフ（vs `--enable-media-stream`）

- 利点: OBS にカメラを触らせない／Chrome の精度・速度で回せる／別PCの Chrome から送ることも可能。
- 欠点: **中継サーバを1個起動する手間**が増える。本番（GitHub Pages の静的配信）では中継サーバを
  別途用意する必要がある（ローカル配信なら問題なし）。
- すでに `--enable-media-stream` で動くので、これは「OBS にカメラを使わせたくない」
  「Chrome の精度/速度で回したい」場合の代替アーキ。

## 実装するなら（追加は3点）

- WS サーバ（小）: signals を受けて全受信クライアントへブロードキャスト。
- 送信フック: トラッキング結果（signals）を WS で送る。
- 受信モード分岐: `?recv=ws` でカメラを起動せず、WS の signals を ref に適用。
