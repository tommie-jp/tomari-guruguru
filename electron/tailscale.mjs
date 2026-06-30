// 自機の Tailscale MagicDNS FQDN を取得するユーティリティ（Electron main から使う）。
//
// ねらい: スマホ(tx) が開く QR を「https://<fqdn>/index.html?tx」にするため、起動時に自機の
//   MagicDNS 名を得る。TLS 終端は `tailscale serve` が前段で担うので、ここは FQDN 取得だけ。
//
// 設計:
//   - パース部 parseTailscaleFqdn(jsonString) を純関数に分離してユニットテストする。
//   - 実行は execFile（shell 無し＝インジェクション/PATH 曖昧さ回避）。Windows は tailscale.exe が
//     PATH に居ないことが多いので既知パスを探索する。
//   - 失敗（未導入/未ログイン/MagicDNS無効）は例外。呼び出し側は握り潰して loopback にフォールバック。
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

// tailscale CLI の場所を解決する。PATH に無い Windows を考慮し既知パスを探す。
export function resolveTailscaleBin() {
  if (process.platform === 'win32') {
    const candidates = [
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Tailscale', 'tailscale.exe'),
      'C:\\Program Files\\Tailscale IPN\\tailscale.exe',
    ];
    return candidates.find((p) => existsSync(p)) || 'tailscale.exe';
  }
  const candidates = [
    '/usr/bin/tailscale',
    '/usr/local/bin/tailscale',
    '/opt/homebrew/bin/tailscale',
    '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
  ];
  return candidates.find((p) => existsSync(p)) || 'tailscale';
}

// `tailscale status --json` の出力から自機 FQDN を取り出す純関数。
// Self.DNSName は末尾ドット付き FQDN（schema 上保証）なので 1 つだけ剥がす。
// BackendState が Running でない / DNSName 空 / JSON 不正は throw。
export function parseTailscaleFqdn(jsonString) {
  let status;
  try {
    status = JSON.parse(jsonString);
  } catch {
    throw new Error('tailscale status --json をパースできません');
  }
  if (status.BackendState && status.BackendState !== 'Running') {
    throw new Error(`Tailscale が起動していません (BackendState=${status.BackendState})`);
  }
  const dnsName = status && status.Self && status.Self.DNSName;
  if (!dnsName) {
    throw new Error('Self.DNSName が空です（未ログイン？）');
  }
  return dnsName.replace(/\.$/, ''); // 末尾ドットを 1 つだけ剥がす
}

// 自機の Tailscale MagicDNS FQDN を取得する Promise。失敗時は reject。
export function getTailscaleFqdn({ bin = resolveTailscaleBin(), timeout = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(bin, ['status', '--json'], { windowsHide: true, timeout }, (err, stdout) => {
      if (err) {
        reject(err);
        return;
      }
      try {
        resolve(parseTailscaleFqdn(stdout));
      } catch (parseErr) {
        reject(parseErr);
      }
    });
  });
}
