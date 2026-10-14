#!/usr/bin/env node
// 打安装包：先摆出程序目录（便携 Node、构建好的运行端（只带运行依赖）、WebUI 和托管脚本），再用 Inno Setup 打成 mcbot-setup-<版本>.exe。
// 用法：node scripts/package.mjs [--out output/package] [--node <node.exe>] [--iscc <ISCC.exe>] [--skip-build] [--no-installer]
// 不带模组 jar（核心也不带）：插件页按总清单从服务器或 GitHub 下载，jar 由 release.mjs 单独摆出。程序目录里也不放用户数据。
// 不联网：运行依赖复制 client-runtime 已装好的，再 npm prune 掉开发依赖。
// Node 要用官方 zip 版（带 LICENSE）：解压到 runtime/node-dist/node-v<版本>-win-x64，或用 --node 指定。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadCompat, checkCompat } from './check-compat.mjs';
import { readAppVersion } from './version.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 程序目录里跑的入口；它们 import 的同目录脚本会自动带上
export const ENTRIES = ['webui.mjs', 'start-server-play.mjs', 'companion.mjs'];
// client-runtime 里随包带的文件（dist 和运行依赖另外处理）；scripts 按文件读的 JSON（工具表、叫停词、记忆上限、托管时长）都要列在这里，不然绿色版启动就报缺文件
export const RUNTIME_FILES = ['package.json', 'package-lock.json', 'README.md', 'tool-registry.json', 'player-stop.json', 'memory-limits.json', 'host-timing.json'];
export const ASSETS = ['webui-page.html'];
const TOP_FILES = ['compat.json', 'LICENSE', 'NOTICE', 'CLAUDE.md'];
// 安装标记：程序目录里有它就是安装版，数据放 %LOCALAPPDATA%mcbot（scripts/paths.mjs 认这个文件名，不能改）
export const INSTALL_MARKER = 'install.json';
// 程序目录里不该有的用户数据目录：目标目录里有它们就拒绝打包，免得连数据一起删掉
export const DATA_DIRS = ['runtime', 'memory'];
export const ISS = path.join(ROOT, 'installer', 'mcbot.iss');

/** 默认用 runtime/node-dist 里解压好的官方 Node（版本最新的那个）；没有就用当前的 Node。 */
function defaultNode() {
  const dir = path.join(ROOT, 'runtime', 'node-dist');
  let found = [];
  try { found = fs.readdirSync(dir).filter((n) => /^node-v\d+\.\d+\.\d+-win-x64$/.test(n) && fs.existsSync(path.join(dir, n, 'node.exe'))); } catch { /* 没有就用当前的 */ }
  const key = (n) => n.match(/\d+/g).slice(0, 3).map(Number);
  found.sort((a, b) => { const x = key(a), y = key(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; });
  return found.length ? path.join(dir, found.at(-1), 'node.exe') : process.execPath;
}

export function parsePackageArgs(argv) {
  const o = { out: path.join(ROOT, 'output', 'package'), node: defaultNode(), iscc: '', build: true, installer: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') o.out = path.resolve(argv[++i]);
    else if (a === '--node') o.node = path.resolve(argv[++i]);
    else if (a === '--skip-build') o.build = false;
    else if (a === '--iscc') o.iscc = path.resolve(argv[++i]);
    else if (a === '--no-installer') o.installer = false;
    else throw new Error(`不支持的参数：${a}（可用参数：--out、--node、--iscc、--skip-build、--no-installer）`);
  }
  return o;
}

/** scripts 下从入口出发 import 到的同目录脚本（相对路径的静态和动态 import）。 */
export function scriptClosure(dir, entries) {
  const seen = new Set();
  const visit = (rel) => {
    const norm = path.normalize(rel);
    if (seen.has(norm)) return;
    const file = path.join(dir, norm);
    if (!fs.existsSync(file)) throw new Error(`scripts/${norm} 不存在`);
    seen.add(norm);
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/(?:from\s+|import\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const target = path.normalize(path.join(path.dirname(norm), m[1]));
      if (target.startsWith('..')) throw new Error(`scripts/${norm} 引用了 scripts 以外的 ${m[1]}，绿色版中不包含该文件`);
      visit(target);
    }
  };
  for (const e of entries) visit(e);
  return [...seen].sort();
}

// Windows 上 npm 是 npm.cmd，要经 cmd 跑；参数都是这里写死的，不含用户输入
const run = (cmd, args, cwd) => {
  const [exe, all] = process.platform === 'win32' ? [process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', cmd, ...args]] : [cmd, args];
  const r = spawnSync(exe, all, { cwd, stdio: 'inherit', windowsHide: true });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} 失败（退出码 ${r.status}）`);
};
const copy = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.cpSync(from, to, { recursive: true }); };


function readme(compat, version) {
  const p = compat.platform;
  return [
    `mcbot ${version}`,
    '',
    '使本机的 AI（Claude Code、Codex、DeepSeek Harness）在 Minecraft 中控制一个游戏伙伴。',
    '',
    `支持：Minecraft ${p.minecraft}，NeoForge ${p.loaderMin} 及以上（${p.loaderMin.split('.').slice(0, 2).join('.')} 系列），独立服务器或已对局域网开放的单人世界。`,
    '',
    '使用方法',
    '1. 在本机安装并登录一个 Agent：Claude Code、Codex 或 DeepSeek Harness。程序不会代为登录。',
    '2. 从开始菜单或桌面的「mcbot」打开，浏览器将打开 WebUI。',
    '3. 在「配置」页新建配置，在「连接配置」中选择游戏目录（服务器目录或启动器实例）。',
    '4. 在「插件」中安装核心模组和所需插件（需要联网下载）。修改前请备份存档。',
    '5. 启动服务器，或进入单人世界后按 Esc 选择「对局域网开放」。',
    '6. 点击「保存并启动托管」。',
    '',
    '人设、记忆、配置和下载缓存保存在 %LOCALAPPDATA%\\mcbot，不在本目录；卸载时会询问是否一并删除。',
    '连接文件（config/mcbot-server-control/connection.json）中含有控制令牌，仅保存在本机，请勿发送给他人。',
    '支持的模组及确切版本见 compat.json；对于清单以外的模组，Bot 将拒绝操作。',
    '',
    '本程序附带 Node.js（node 文件夹，MIT 许可，见 node/LICENSE）。本项目以 Apache License 2.0 发布，见 LICENSE、NOTICE。',
    '',
  ].join('\r\n');
}

/** 找 Inno Setup 的命令行编译器：--iscc 指定的，或默认安装位置（含按用户安装），或 PATH 里的。 */
export function findIscc(given) {
  if (given) { if (!fs.existsSync(given)) throw new Error(`未找到 ${given}`); return given; }
  const candidates = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')]
    .filter(Boolean).map((d) => path.join(d, 'Inno Setup 6', 'ISCC.exe'));
  const hit = candidates.find((f) => fs.existsSync(f));
  if (hit) return hit;
  const where = spawnSync('where', ['ISCC.exe'], { encoding: 'utf8', windowsHide: true });
  if (where.status === 0 && where.stdout.trim()) return where.stdout.trim().split(/\r?\n/)[0];
  throw new Error('未找到 Inno Setup 6 的 ISCC.exe（请安装后重试，或使用 --iscc 指定；仅需程序目录时可使用 --no-installer）');
}

/** 打包前清空的目标目录里不能有用户数据，也不能是仓库本身或它的上级。 */
export function assertSafeStage(stage) {
  const rel = path.relative(stage, ROOT);
  if (!rel || (!rel.startsWith('..') && !path.isAbsolute(rel))) throw new Error(`打包目录 ${stage} 是仓库或仓库的上级目录，拒绝打包`);
  const found = DATA_DIRS.filter((d) => fs.existsSync(path.join(stage, d)));
  if (found.length) throw new Error(`打包目录 ${stage} 里有 ${found.join('、')}，像是有用户数据，拒绝打包（打包前会清空这个目录）。请换一个 --out，或先把数据移走`);
}

export function buildPackage(opts) {
  const compat = loadCompat();
  const problems = checkCompat(compat);
  if (problems.length) throw new Error(`compat.json 与代码不一致，请先修复：\n- ${problems.join('\n- ')}`);
  const version = readAppVersion(ROOT);
  const nodeVersion = spawnSync(opts.node, ['--version'], { encoding: 'utf8' }).stdout?.trim() || '';
  const major = Number(/^v(\d+)\./.exec(nodeVersion)?.[1] || 0);
  if (major < Number(compat.platform.node)) throw new Error(`待打包的 Node 版本为 ${nodeVersion || '无法读取'}，最低要求 ${compat.platform.node}（使用 --node 指定）`);
  const nodeLicense = path.join(path.dirname(opts.node), 'LICENSE');
  if (!fs.existsSync(nodeLicense)) throw new Error(`${path.dirname(opts.node)} 中缺少 Node 的 LICENSE，请使用官方发行包中的 node.exe`);
  const iscc = opts.installer ? findIscc(opts.iscc) : '';

  const name = `mcbot-${version}-win-x64`;
  const stage = path.join(opts.out, name);
  assertSafeStage(stage);

  if (opts.build) run('npm', ['run', 'build'], path.join(ROOT, 'client-runtime'));
  const dist = path.join(ROOT, 'client-runtime', 'dist', 'main.js');
  if (!fs.existsSync(dist)) throw new Error('client-runtime 尚未构建（npm run build）');

  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });

  copy(opts.node, path.join(stage, 'node', 'node.exe'));
  copy(nodeLicense, path.join(stage, 'node', 'LICENSE'));

  const rt = path.join(stage, 'client-runtime');
  for (const f of RUNTIME_FILES) copy(path.join(ROOT, 'client-runtime', f), path.join(rt, f));
  copy(path.join(ROOT, 'client-runtime', 'dist'), path.join(rt, 'dist'));
  // 复制本机装好的依赖（npm ci 装的、和 lock 一致），再删掉开发依赖；prune 只删不下载
  const modules = path.join(ROOT, 'client-runtime', 'node_modules');
  if (!fs.existsSync(modules)) throw new Error('client-runtime 尚未安装依赖（npm ci）');
  copy(modules, path.join(rt, 'node_modules'));
  run('npm', ['prune', '--omit=dev', '--offline', '--no-audit', '--no-fund', '--ignore-scripts'], rt);

  const scripts = scriptClosure(path.join(ROOT, 'scripts'), ENTRIES);
  for (const rel of [...scripts, ...ASSETS]) copy(path.join(ROOT, 'scripts', rel), path.join(stage, 'scripts', rel));
  for (const f of TOP_FILES) copy(path.join(ROOT, f), path.join(stage, f));
  fs.writeFileSync(path.join(stage, INSTALL_MARKER), JSON.stringify({ app: 'mcbot', version }, null, 2) + '\n');
  fs.writeFileSync(path.join(stage, '使用说明.txt'), '﻿' + readme(compat, version));

  let installer = '';
  if (iscc) {
    installer = path.join(opts.out, `mcbot-setup-${version}.exe`);
    fs.rmSync(installer, { force: true });
    const r = spawnSync(iscc, ['/Q', `/DAppVersion=${version}`, `/DStageDir=${stage}`, `/O${opts.out}`, ISS], { stdio: 'inherit', windowsHide: true });
    if (r.status !== 0 || !fs.existsSync(installer)) throw new Error(`Inno Setup 打包失败（退出码 ${r.status}）`);
  }
  const size = (p) => { let n = 0; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const q = path.join(d, e.name); if (e.isDirectory()) walk(q); else n += fs.statSync(q).size; } }; walk(p); return n; };
  return { name, stage, installer, version, node: nodeVersion, scripts, stageBytes: size(stage), installerBytes: installer ? fs.statSync(installer).size : 0 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const r = buildPackage(parsePackageArgs(process.argv.slice(2)));
    const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
    console.log(`\nmcbot ${r.version}：Node ${r.node}，脚本 ${r.scripts.length} 个`);
    console.log(`程序目录 ${r.stage}（${mb(r.stageBytes)}）`);
    if (r.installer) console.log(`安装包 ${r.installer}（${mb(r.installerBytes)}）`);
  } catch (e) { console.error(e.message); process.exit(1); }
}
