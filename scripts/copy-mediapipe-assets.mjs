// MediaPipe Face Landmarker のアセットを public/ に配置する。
//   1) WASM 一式を node_modules からコピー（高速・常に上書き）
//   2) モデル(.task)を Google ストレージからダウンロード（無い時のみ）
// public/mediapipe/ は .gitignore 対象なので、このスクリプトで都度再生成する。
import { cp, mkdir, access, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const wasmSrc = resolve(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const wasmDest = resolve(root, 'public/mediapipe/wasm');
const modelDest = resolve(root, 'public/mediapipe/face_landmarker.task');

// float16 版（精度と軽さのバランスが良い公式モデル）
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await exists(wasmSrc))) {
    throw new Error(
      `WASM が見つかりません: ${wasmSrc}\n先に \`npm i @mediapipe/tasks-vision\` を実行してください。`,
    );
  }

  await mkdir(wasmDest, { recursive: true });
  await cp(wasmSrc, wasmDest, { recursive: true });
  console.log('[mediapipe] WASM をコピーしました →', wasmDest);

  if (await exists(modelDest)) {
    console.log('[mediapipe] モデルは配置済みのためスキップ →', modelDest);
    return;
  }

  console.log('[mediapipe] モデルをダウンロード中 …', MODEL_URL);
  const res = await fetch(MODEL_URL);
  if (!res.ok) {
    throw new Error(`モデルのダウンロードに失敗: ${res.status} ${res.statusText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(modelDest, buf);
  console.log(
    `[mediapipe] モデルを保存しました (${(buf.length / 1e6).toFixed(1)} MB) →`,
    modelDest,
  );
}

main().catch((err) => {
  console.error('[mediapipe] セットアップ失敗:', err.message);
  process.exit(1);
});
