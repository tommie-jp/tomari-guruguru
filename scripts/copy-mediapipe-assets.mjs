// MediaPipe Face Landmarker のアセットを public/ に配置する。
//   1) WASM 一式を node_modules からコピー（高速・常に上書き）
//   2) モデル(.task)を Google ストレージからダウンロード（無い時のみ）
// public/mediapipe/ は .gitignore 対象なので、このスクリプトで都度再生成する。
import { cp, mkdir, access, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const wasmSrc = resolve(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const wasmDest = resolve(root, 'public/mediapipe/wasm');
const modelsDir = resolve(root, 'public/mediapipe');

// float16 版（精度と軽さのバランスが良い公式モデル）。無い時だけDLする。
const MODELS = [
  {
    file: 'face_landmarker.task',
    url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  },
  {
    file: 'gesture_recognizer.task',
    url: 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task',
  },
  {
    file: 'pose_landmarker_lite.task',
    url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  },
];

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function downloadModel({ file, url }) {
  const dest = resolve(modelsDir, file);
  if (await exists(dest)) {
    console.log('[mediapipe] 配置済みのためスキップ →', file);
    return;
  }
  console.log('[mediapipe] ダウンロード中 …', file);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`モデルのダウンロードに失敗 (${file}): ${res.status} ${res.statusText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
  console.log(`[mediapipe] 保存しました (${(buf.length / 1e6).toFixed(1)} MB) → ${file}`);
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

  for (const model of MODELS) {
    await downloadModel(model);
  }
}

main().catch((err) => {
  console.error('[mediapipe] セットアップ失敗:', err.message);
  process.exit(1);
});
