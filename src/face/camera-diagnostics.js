// カメラ起動失敗時に、原因切り分け用の詳細情報を集めて文字列化する。
// OBS ブラウザソース(CEF)など、短いメッセージだけでは原因が分かりにくい環境向け。
// エラー名・secure context・mediaDevices 有無・カメラ検出台数・権限状態などを出す。

// getUserMedia の例外 name → 日本語の原因ヒント。
const ERROR_HINTS = {
  NotAllowedError: 'カメラ使用が拒否されました（OS/ブラウザ/OBS の許可、または Permissions Policy）。',
  NotReadableError: 'カメラを開けません（他アプリ/他ソースが使用中＝ハード占有の可能性）。',
  NotFoundError: 'カメラが見つかりません（接続・ドライバ・選択デバイスを確認）。',
  OverconstrainedError: '要求した解像度などに一致するカメラがありません。',
  SecurityError: 'セキュリティ制約でカメラを使えません（secure context か確認）。',
  AbortError: 'カメラの起動が中断されました。',
  TypeError: 'getUserMedia 呼び出しが不正、または mediaDevices が使えません。',
};

/**
 * エラー名から人間向けのヒントを返す（純関数・テスト対象）。
 * @param {string} name
 * @returns {string}
 */
export function hintForErrorName(name) {
  return ERROR_HINTS[name] || '不明なエラー。下の詳細（UA・台数など）を確認してください。';
}

// 例外を投げずに値を1行追加するための小ヘルパ。
function pushSafe(lines, label, getter) {
  try {
    lines.push(`${label}: ${getter()}`);
  } catch {
    lines.push(`${label}: (取得不可)`);
  }
}

/**
 * カメラ失敗時の診断情報を集めて整形する（navigator 等の環境 API を読む）。
 * 診断目的なので、内部のどの取得が失敗しても全体は決して throw しない。
 * @param {unknown} err getUserMedia などが投げた例外
 * @returns {Promise<{ name: string, message: string, hint: string, lines: string[] }>}
 */
export async function collectCameraDiagnostics(err) {
  const name = err?.name || 'Error';
  const message = err?.message || String(err);
  const hint = hintForErrorName(name);

  const lines = [`${name}: ${message}`, hint];

  pushSafe(lines, 'secure context', () =>
    (typeof window !== 'undefined' ? window.isSecureContext : 'unknown'));
  pushSafe(lines, 'origin', () =>
    (typeof location !== 'undefined' ? location.origin : 'unknown'));

  const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  lines.push(`mediaDevices: ${md ? 'あり' : 'なし'} / getUserMedia: ${md?.getUserMedia ? 'あり' : 'なし'}`);

  // 権限状態（対応していれば denied/prompt/granted が分かる。CEW では未対応のことも）
  if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
    try {
      const st = await navigator.permissions.query({ name: 'camera' });
      lines.push(`permissions.camera: ${st.state}`);
    } catch {
      lines.push('permissions.camera: (照会不可)');
    }
  }

  // カメラの検出台数。未許可だとラベルは空だが、台数（kind=videoinput）は分かるので
  // 「CEF からカメラ自体が見えているか」の判定に使える（0 なら露出されていない）。
  if (md?.enumerateDevices) {
    try {
      const devices = await md.enumerateDevices();
      const cams = devices.filter((d) => d.kind === 'videoinput');
      lines.push(`カメラ検出数: ${cams.length}`);
      cams.forEach((c, i) => lines.push(`  cam${i}: ${c.label || '(ラベル非公開＝未許可)'}`));
    } catch (e) {
      lines.push(`enumerateDevices 失敗: ${e?.message || e}`);
    }
  }

  pushSafe(lines, 'UA', () => navigator.userAgent);

  return { name, message, hint, lines };
}
