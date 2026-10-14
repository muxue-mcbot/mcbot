// 版本号：0.0.1 这种按点分段的数字。比较时按段比较数字（0.0.10 比 0.0.9 新），不按字符串比较。
// 主程序和核心模组同一个版本号，以 client-runtime/package.json 的 version 为准；各适配插件有自己的版本号。
import fs from 'node:fs';
import path from 'node:path';

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** "0.0.12" → [0, 0, 12]；格式不对抛错。 */
export function parseVersion(text) {
  const m = VERSION.exec(String(text ?? '').trim());
  if (!m) throw new Error(`版本号格式不对：${text}（应为 0.0.1 这样的三段数字）`);
  return m.slice(1).map(Number);
}

/** a 比 b 旧返回 -1，相同 0，新 1。 */
export function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

/** 程序目录里主程序的版本（client-runtime/package.json）。 */
export function readAppVersion(programDir) {
  const pkg = JSON.parse(fs.readFileSync(path.join(programDir, 'client-runtime', 'package.json'), 'utf8'));
  parseVersion(pkg.version);
  return pkg.version;
}
