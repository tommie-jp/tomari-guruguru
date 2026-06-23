# PRD: 演出（スタンプ）のアバター相対 表示位置を演出毎に調整する

- 対象: camera 版（`camera.html` / `src/camera-app.jsx`）
- ステータス: 設計確定・実装着手前（2026-06-22）
- スコープ: 表示位置のみ。アニメスピード等の他プロパティは将来。

## 1. 背景と目的

演出（cue）には 2 系統ある。

- スタンプ系（💢 ✨ ！？ こんにちは！）… `src/cue-stamp.jsx` がアバター矩形を基準に
  毎フレーム頭上/頭部へ重畳する。**アバター相対の「表示位置」を持つのはこちらだけ。**
- モーション系（回転 / うなずき / いやいや＋おまけ 5 種）… `src/gestures.js` がアバター本体を
  その場で rotate / scale するだけで、表示位置の概念が無い。

現状スタンプの縦位置は `place`（`above` = 頭の上 / `over` = 頭にオーバーレイ）と
固定係数（`HEAD_CENTER_Y` 等）のみで、cue ごとの微調整ができない。
本機能で **cue 毎にアバター相対のオフセットをドラッグで調整・保存**できるようにする。

## 2. ユーザー決定（確定事項）

- トリガー = **両方**。主動線は可視トグル「演出の位置を調整」、上級者ショートカットとして
  PC 右クリック / モバイル長押し。両経路とも同一の編集状態へ集約する。
- スコープ = **今回はスタンプ系のみ**実装。ただしデータ模型・適用フックは
  **将来モーションの位置移動にも拡張できる形**にしておく。
- 調整単位は全アバター共通（グローバル）。per-avatar は将来。
- クランプ範囲は ±1.5em（既定）。OBS/受信側へは relay しない（ローカル限定）。

## 3. 非目標（このリリースでやらないこと）

- モーション系（gesture）の位置移動の実配線。データ模型のみ拡張可能にしておく。
- per-avatar の個別調整。
- アニメスピード・サイズ・place の編集。
- offset の relay 同期（rx/OBS は既定位置のまま）。

## 4. 仕様

### 4.1 座標モデル

- offset は **em 単位**（= スタンプ fontSize 基準 = アバター幅比）で保存する。
- `placeNode` は毎フレーム `getBoundingClientRect().width` を読むため、em 保存なら
  charSize 変更・ホイール/ピンチズーム・画面回転・OBS 解像度に対してスケール不変。
- 既存ジッタ（`cue-stamp.jsx` の `cx + jit*fontSize`）と同一単位で一貫させる。
- ドラッグ移動量 → em は `delta_px / 現在fontSize` で換算する。
- 既定は `{x:0, y:0}`。`0*fontSize = 0` なので**未調整 cue は既存表示とバイト一致**。

### 4.2 データ模型と永続化

- 形: `{ [cueId]: { x: number, y: number } }`（単一マップ）。
- 保存先: **サイドカーキー** `tomari-tweaks:<page>:cueoffset`
  （`:panelpos` / `:sections` と同型の独立レイヤー）。
- tweaks 値本体には**入れない**。`mergeIntoDefaults` が未知キーを破棄し、
  `shallowEqualValues` が primitive 前提のため、テーマ export / reset が壊れるため。
- `use-tweaks.js` に `cueOffsetStorageKey` / `loadCueOffsets` / `saveCueOffsets` /
  `clearCueOffsets` / 純関数 `clampCueOffset(o, -1.5, 1.5)` を追加（panelPos ブロック隣）。
- 将来 per-avatar: `getCueOffset(cueId)` アクセサ越しに disk 形を
  `{ [avatarId]: { [cueId]: {x,y} } }` へ 1 行マイグレーション。旧 flat マップは
  予約キー `__shared` へ退避し、`avatarId → __shared → {0,0}` で解決する。

### 4.3 適用フック（2 系統）

- スタンプ（今回）: `cue-stamp.jsx` の `placeNode` で
  `left = cx + (jit + ox)*fontSize`、`top = topY + oy*fontSize`。
  発火経路は `pop(cue)` が `cue.__offset` を読み、item に `ox/oy` を載せ、
  `data-offset-x/y` 経由で `placeNode` へ渡す。
- モーション（将来）: ジェスチャー再生ループ（`camera-app.jsx` の `gestureFxRef`）で
  `transform` 先頭に `translate(x*r.width, y*r.width)` を前置。同じ em/幅比単位。

### 4.4 トリガー

- 可視トグル「演出の位置を調整」をサウンドボード列の先頭に置く（`!obsMode && !isRx && t.sbButtons`）。
  ON で編集モードに入り、cue ボタンのクリックは発火ではなく「調整対象の選択」になる。
- PC: cue ボタン `onContextMenu` で `e.preventDefault()` し、その cue の編集を直接開く
  （ブラウザメニュー抑制、`run()` は呼ばない）。
- モバイル: 長押し。`pointerdown` で 500ms タイマー、`pointerup`<500ms は通常発火、
  移動 >8px / `pointercancel` でキャンセル、発火後は `justOpenedRef` で後続 click を握りつぶす。
- gesture-only cue（スタンプ無し）は編集対象外。編集モードでは通常発火（モーションのプレビュー）に留める。

### 4.5 エディタ UI（独立コンポーネント `cue-offset-editor.jsx`）

- 掴むのはアバター本体。編集中だけ透明な全面オーバーレイを敷き、`setPointerCapture` で追従。
- パネルは退避可能なクローム。既存 `draggable-panel.jsx` を流用し、
  `✓保存 / ✕やめる / ↺既定に戻す` ＋ 現在 x/y 数値を表示。
- ライブプレビュー: 編集中は実 `cueStampRef.current.pop({ ...cue, __offset: draft })` を
  `holdMs` 間隔で再発火し、本番と同一の `placeNode` で実スタンプを表示する。
- ドラッグ中は自動保存しない（確定は常に明示）。`保存`で map へ書き込み＋localStorage。
  `やめる`/`✕`は draft 破棄（保存値は不変）。`既定に戻す`は draft を `{0,0}` に。
- z 順: オーバーレイ（ドラッグ面）＜ サウンドボード列（対象切替のため上）＜ エディタパネル。
- 全要素 `!obsMode && !isRx` でゲート。

## 5. 段階実装

1. 永続化層 `:cueoffset`（純関数＋テスト、UI なし・無リスク）。
2. `placeNode` に em offset 適用（UI なし。純関数 `computeStampBox` に切り出してテスト。
   `{0,0}` で既存出力一致を検証）。
3. トリガー配線（可視トグル＋右クリック/長押し、`editingCueId` 状態）。
4. エディタ UI（`cue-offset-editor.jsx`：全面オーバーレイ＋DraggablePanel＋ライブプレビュー＋確定）。
5. （任意）Tweaks「演出」セクションへトグルをミラー。

## 6. テスト計画

- `use-tweaks.test.js`: `cueOffsetStorageKey` 形式、save/load 往復、サニタイズ（非有限/非オブジェクト破棄）、
  壊れ JSON→`{}`、未保存→`{}`、clear→`{}`、`clampCueOffset` 境界・非有限→0。
- `cue-stamp` の `computeStampBox`: `ox=oy=0` が変更前の left/top に一致、
  offset 分だけ `fontSize` 倍シフト、`above`/`over` の縦アンカー差。
- 手動: ドラッグ→保存→リロードで位置維持、charSize 変更/ズームでスケール追従、
  OBS/rx で編集 UI 非表示・既定位置表示、モバイル長押し vs スクロール/タップの分離。

## 7. 落とし穴

- 単位は em（幅比）固定。px/vw 混在禁止（リサイズで破綻）。
- 長押しとスクロール/タップ/ピンチの誤判定（移動 8px・2 本指で不発火・`pointercancel` でフラグ確実リセット）。
- 一部タッチブラウザは長押し後に合成 `contextmenu` を出す → 二重オープンガード。
- offset はローカル限定で relay されない（rx/OBS は既定位置）。仕様として明記。
- gesture-only cue は今回 no-op（編集対象から除外）。
- 初フレームちらつき防止に `data-offset-x/y` を初回 `placeNode` 前にセット。
- `cueController` は `useMemo` 化されているため、発火時の offset は **ref 経由**で読む
  （クロージャの陳腐化回避）。

## 8. 関連

- `src/cue-stamp.jsx` / `src/cue-system.js` / `src/gestures.js` / `src/camera-app.jsx`
- `src/use-tweaks.js` / `src/draggable-panel.jsx`
- docs-camera/30-カメラ版のエフェクト.md
