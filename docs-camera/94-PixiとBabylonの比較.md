# PixiJS と Babylon.js の比較

カメラ版アバターの描画を現状の **PixiJS v8** から **Babylon.js** へ替えるか検討するための比較メモ。
演出種類だけでなく、GPU / CPU 負担・バンドルサイズ・本用途への適性まで含めて整理する。

調査時点のバージョン: PixiJS `8.19.0` / `@babylonjs/core 9.13.0`。

## 結論（先に）

**「Pixi でできる演出はだいたい Babylon でもできる」**（Babylon はポストプロセス・パーティクル・
カスタムシェーダを標準装備したフル 3D エンジンで、Pixi の 2D 演出はほぼ再現できる上位互換寄り）。

本アバターの演出は 3 層で構成され、移植への影響は層ごとに違う。

- 自作 WebGL GLSL フィルタ（`glow.js` / `dissolve.js`）… 移植対象はここだけ。生 GLSL なので Babylon の `ShaderMaterial` / `PostProcess` へほぼ素移植できる。
- CSS transform の gesture（`gestures.js`）… 描画ライブラリ非依存。移植不要。
- DOM / CSS の cue / stamp（`cue-stamp.jsx`）… 描画ライブラリ非依存。移植不要。

非対称は 2 方向だけ。

- **Pixi 有利**: 様式化 2D フィルタ（Glitch / CRT / Outline 等）が `pixi-filters` で 1 行ポン付け、2D Spine、そして軽さ。
- **Babylon 有利**: 3D 背景 / 奥行き、GPU 大量パーティクル。

## 総合比較表

| 項目 | PixiJS v8 | Babylon.js | 有利 |
| ---- | ---- | ---- | ---- |
| 描画種別 | 2D 専用（billboard ネイティブ） | 3D（2D は平面で 2D 化＝一手間） | 同等 |
| バンドルサイズ | min 881KB / gzip 251KB | フル min 7.37MB / gzip 1.64MB（tree-shake 後 ~0.6–1.5MB） | **Pixi**（8–10 倍、削っても 2–3 倍） |
| 起動 / 初回ロード | 軽い | 重い（3D 一式初期化） | **Pixi** |
| メモリ常駐 | 小 | 大 | **Pixi** |
| GPU 負担（同一描画 = 1 枚） | 誤差レベル | 誤差レベル | 同等（現代 GPU で余裕） |
| GPU 負担（大量パーティクル） | JS 更新 = CPU 寄り | GPUParticleSystem で GPU オフロード | **Babylon** |
| CPU 負担（毎フレーム） | 極小（reactive、静止 100k で 0.12ms） | 高め（毎 F 行列 / カリング / パイプライン） | **Pixi** |
| パーティクル | △ 別ライブラリ | ○ ネイティブ（GPU 可） | Babylon |
| ポストプロセス連鎖 | ○ `filters` 配列 | ○ PostProcess チェーン | 同等 |
| 2D フィルタ（様式化） | ○ pixi-filters 1 行 | △ 自作 / NME | **Pixi** |
| カスタムシェーダ | ○ Filter+GLSL | ○ ShaderMaterial / NME | 同等 |
| ライティング | ✕ | ○ | Babylon（本件未使用） |
| 3D 背景 / 奥行き | ✕ | ○ | **Babylon**（決定的差） |
| アニメ / トゥイーン | △ 外部（GSAP 等） | ○ ネイティブ Easing | Babylon（本件は CSS 自前） |
| テキスト / GUI | ○ | ○ GUI | 同等 |
| トランジション | ○/△ 自作 | ○/△ 自作 / NME 例 | 同等 |
| WebGPU 対応 | ○ v8 コア統合 | ○ 5.0+（compute 正式） | 同等（将来性は Babylon） |
| エコシステム / 学習 | 2D 特化・速い | 3D 全部入り・広い / 重い | 目的次第 |
| 本アバター適性 | ○ 最適・軽量 | △ オーバースペック | **Pixi** |

## 演出別 対応表

凡例: ○ ネイティブ / △ 要ライブラリ・自作 / ✕ 不可。

| 演出 | Pixi | Babylon | メモ |
| ---- | ---- | ---- | ---- |
| 発光 glow / bloom | △ 自作 or pixi-filters | ○ GlowLayer / bloom | Babylon は発光が標準 |
| ディゾルブ / 溶解 | △ 自作 GLSL（実装済） | △ 移植 / NME 例 | GLSL 共通化で移植可 |
| 色調整 / トーンマップ | ○/△ ColorMatrix+lib | ○ ImageProcessing | 配信ルックは Babylon 標準 |
| グレイン / 色収差 | △ OldFilm / RGBSplit | ○ pipeline 設定一発 | 双方可 |
| アウトライン | △ Outline（画素） | ○/△ Highlight（メッシュ） | 流儀違い |
| 歪み / Displacement | ○/△ プリセット多 | △ 自作 | Pixi 楽 |
| ブラー | ○/△ 種類豊富 | ○ Blur+DOF | |
| グリッチ / CRT / ASCII 等 | △ 既製 1 行 | △ 全部自作 | **Pixi 在庫多** |
| パーティクル | △ 別ライブラリ（CPU） | ○ GPU 可 | Babylon |
| スプライト / 2D（5x5 切替） | ○ ネイティブ | ○/△ 一手間 | Pixi 直球 |
| スケルタル / Spine（2D） | ○ pixi-spine 成熟 | △ 限定的 | **Pixi** |
| 3D（モデル / 光 / 奥行き / DOF） | ✕ | ○ | **Babylon** |
| gesture（面内 rotate / scale） | ○ CSS（非依存） | ○ 同じ CSS 再利用 | 移植不要 |
| cue / stamp | ○ DOM / CSS | ○ 同じ | 移植不要 |

## GPU / CPU の要点

- **同一の見た目（1 枚）なら GPU 差は実質ゼロ**。律速は GPU より CPU 側で、Babylon は毎フレーム 3D パイプライン（シーングラフ走査・WVP 行列・カリング）が走るぶん CPU ベースラインが構造的に高い。Pixi v8 は reactive ループで静止フレームをほぼ再計算しない（本件の「1 セル静止＋たまに切替」と相性最良）。ただし 1 オブジェクトなら絶対値が小さく体感差は出にくい。
- **GPU が効くのは大量・常時パーティクル**。Babylon `GPUParticleSystem` は更新まで GPU に逃がせて CPU を使わない＝ここだけ Babylon が明確に有利。
- **落とし穴**: Babylon の `PostProcess` はカメラ全画面が基本。本件の「1 スプライト局所の glow / dissolve」を素直に全画面 PostProcess 化すると GPU が無駄打ちになる。平面ローカルの `ShaderMaterial` / NodeMaterial にするのが前提（怠ると Babylon の GPU 評価が不当に悪く出る）。

## 本プロジェクトへの示唆

- **3D を使わない現状は Pixi v8 維持が合理的**。演出パリティはほぼ互角なのに、Babylon 化で得る新規演出は現状ほぼ無く、サイズ・起動・メモリ・CPU は一貫して Pixi が軽い（OBS / CEF は 1 ソース = 1 プロセスで毎回新規ロード＝軽さがそのまま効く）。
- **Babylon 移行の価値が出るのは**「実 3D 背景 / 奥行き / DOF」「大量 GPU パーティクル」「WebGPU compute で演出 GPU 化」を確実に導入する計画があるときだけ。その場合でも gesture / stamp はそのまま再利用、移植対象は生 GLSL 2 本だけなので移植コスト自体は小さい。
- 関連: [30-カメラ版のエフェクト](30-カメラ版のエフェクト.md)（現状のエフェクト構成）。CEF / OBS での透過・GPU 実機確認は別途実施済み（`?obs=1` 透過 OK、ハードウェア GPU 有効を確認）。

## 注意点（机上評価の限界）

- Babylon の tree-shake 後サイズ（~0.6–1.5MB）はコミュニティ実測の推定レンジ。barrel import を誤ると 3〜9MB に膨張するため ES6 ファイル指定 import 必須。正確には最小 Babylon シーンを実ビルドして `rollup-plugin-visualizer` 等で実測するのが良い。
- 起動 ms・常駐 MB の直接ベンチは一次ソースが無く、3D エンジンのアーキテクチャ由来の定性比較に留まる。
- `pixi-filters` は v8 互換に当たり外れがある（本件は GlowFilter が v8 で描画されず自作した実例あり）。「Pixi = 常に既製で楽」は常には成り立たない。
- ○/△/✕ は「標準提供か自作が要るか」基準で、見た目の完全一致は別問題（特に glow の滲み方・dissolve の縁発光はアルゴリズム差で絵が変わる）。
