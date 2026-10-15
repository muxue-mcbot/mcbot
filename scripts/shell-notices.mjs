#!/usr/bin/env node
// 桌面窗口 mcbot.exe（shell/）编进去的第三方 Rust crate 的许可证清单：打包时由 package.mjs 写进程序目录的 THIRD-PARTY-NOTICES.txt。
// 按 cargo metadata 从 mcbot-shell 顺着依赖走（只算 Windows x64 上用到的），每个 crate 列名字、版本、许可证、源码地址，
// 再附上它自带的许可证文件（LICENSE*、COPYING*、NOTICE*、license-file 指的文件）；全文一样的只附一次。
// MPL-2.0 等要求说明源码在哪：每个 crate 都写 crates.io 和仓库地址。不联网（--offline），用 shell/Cargo.lock 锁定的版本。
// 用法：node scripts/shell-notices.mjs [输出文件]（不给就打印）
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SHELL_DIR = path.join(ROOT, 'shell');
const TARGET = 'x86_64-pc-windows-msvc';
const LICENSE_FILE_RE = /^(licen[cs]e|copying|notice)/i;

export function cargoMetadata(dir = SHELL_DIR) {
  const r = spawnSync('cargo', ['metadata', '--format-version', '1', '--filter-platform', TARGET, '--locked', '--offline'], { cwd: dir, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  if (r.status !== 0) throw new Error(`cargo metadata 失败（退出码 ${r.status}）：${(r.stderr || '').trim().split('\n').at(-1)}`);
  return JSON.parse(r.stdout);
}

/** 从工作区的包出发，顺着依赖（cargo 已按目标平台筛过）找到的所有第三方包，按名字和版本排序。 */
export function thirdParty(meta) {
  const byId = new Map(meta.packages.map((p) => [p.id, p]));
  const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
  const own = new Set(meta.workspace_members);
  const seen = new Set(), queue = [...own];
  while (queue.length) {
    const id = queue.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const d of nodes.get(id)?.deps || []) queue.push(d.pkg);
  }
  return [...seen].filter((id) => !own.has(id)).map((id) => byId.get(id))
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version, undefined, { numeric: true }));
}

/** 一个包自带的许可证文件：[{ name, text }]。 */
export function licenseFiles(pkg) {
  const dir = path.dirname(pkg.manifest_path);
  const names = new Set();
  try { for (const e of fs.readdirSync(dir, { withFileTypes: true })) if (e.isFile() && LICENSE_FILE_RE.test(e.name)) names.add(e.name); } catch { /* 读不到就只列许可证名 */ }
  if (pkg.license_file) names.add(pkg.license_file);
  return [...names].sort().flatMap((n) => {
    try { return [{ name: n, text: fs.readFileSync(path.resolve(dir, n), 'utf8').replace(/\r\n/g, '\n').trim() }]; } catch { return []; }
  });
}

export function renderNotices(pkgs, read = licenseFiles) {
  const label = (p) => `${p.name} ${p.version}`;
  const texts = new Map(); // 全文 -> 用到它的 crate
  const missing = [];
  const lines = [
    'mcbot.exe（桌面窗口）使用的第三方组件',
    '',
    'mcbot.exe 由 Rust 编写，基于 Tauri（https://tauri.app）。下列开源组件编译在 mcbot.exe 中，各自按其许可证使用。',
    '每个组件的源代码可在列出的 crates.io 页面或仓库地址获取。',
    '',
    `共 ${pkgs.length} 个组件：`,
    '',
  ];
  for (const p of pkgs) {
    lines.push(`- ${label(p)}  许可证：${p.license || '见许可证文件'}  源码：https://crates.io/crates/${p.name}/${p.version}${p.repository ? '  ' + p.repository : ''}`);
    const files = read(p);
    if (!files.length) missing.push(label(p));
    for (const f of files) {
      if (!texts.has(f.text)) texts.set(f.text, []);
      texts.get(f.text).push(`${label(p)}（${f.name}）`);
    }
  }
  if (missing.length) lines.push('', `以下组件的发布包中没有附带许可证文件，按上方列出的许可证使用（同名许可证的全文见下方，版权人见各自的源码仓库）：${missing.join('、')}`);
  lines.push('', '='.repeat(72), '许可证全文（内容相同的只列一次）', '='.repeat(72));
  for (const [text, users] of texts) lines.push('', '-'.repeat(72), `适用于：${users.join('、')}`, '-'.repeat(72), '', text);
  return lines.join('\r\n') + '\r\n';
}

export function writeShellNotices(file, dir = SHELL_DIR) {
  const pkgs = thirdParty(cargoMetadata(dir));
  fs.writeFileSync(file, '﻿' + renderNotices(pkgs));
  return pkgs.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const out = process.argv[2];
    if (out) console.log(`已写入 ${out}（${writeShellNotices(path.resolve(out))} 个组件）`);
    else process.stdout.write(renderNotices(thirdParty(cargoMetadata())));
  } catch (e) { console.error(e.message); process.exit(1); }
}
