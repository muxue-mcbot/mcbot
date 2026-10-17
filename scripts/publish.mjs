#!/usr/bin/env node
// 把 release.mjs 摆好的发布目录传到更新服务器和 GitHub Releases（docs/update_design.md 第五节）。公开操作，跑之前要先问用户。
// 用法：node scripts/publish.mjs [--out output/release] [--ssh <ssh 主机> --dir <服务器上的站点目录>]
//        [--files-ssh <ssh 主机> --files-dir <下载目录>] [--github] [--dry-run]
// - 服务器（--ssh、--dir；对方是 Windows 的 OpenSSH，默认 shell 为 PowerShell）：已有同名同大小的文件跳过，同名大小不同就停下（发布过的文件不能换内容）；
//   先传 app/、core/、plugins/ 里的文件和网站首页 index.html，最后传 index.json（先传成 .tmp 再改名，WebUI 不会读到半截的清单）。
// - 下载文件另放（--files-ssh、--files-dir；对方是 Linux，目录写绝对路径）：app/、core/、plugins/ 里的文件只传到这里，--ssh 的服务器只换网站首页和 index.json。
//   下载文件和网页、清单分开放时（服务器的别名和目录不写进仓库，跑的时候用参数给）：
//   node scripts/publish.mjs --github --files-ssh <下载服务器别名> --files-dir <下载目录> --ssh <站点服务器别名> --dir <站点目录>
//   每个文件先传成 .part 再改名，nginx 不会把半截的文件发出去（也就不会被 Cloudflare 缓存）。
// - GitHub（--github，用 gh 登录的账号；仓库见 webui-update.mjs 的 GITHUB_REPO）：每个 tag 一个 Release（app-v<版本> 放安装包和核心 jar，
//   <插件 id>-v<版本> 放插件 jar），已有的只补缺的文件；固定的 index Release 每次覆盖 index.json。tag 打在当前提交上，提交要先推送。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GITHUB_REPO } from './webui-update.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX_TAG = 'index';

export function parsePublishArgs(argv) {
  const o = { out: path.join(ROOT, 'output', 'release'), ssh: '', dir: '', filesSsh: '', filesDir: '', github: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = () => { if (i + 1 >= argv.length) throw new Error(`${a} 后面要写值`); return argv[++i]; };
    if (a === '--out') o.out = path.resolve(v());
    else if (a === '--ssh') o.ssh = v();
    else if (a === '--dir') o.dir = v();
    else if (a === '--files-ssh') o.filesSsh = v();
    else if (a === '--files-dir') o.filesDir = v();
    else if (a === '--github') o.github = true;
    else if (a === '--dry-run') o.dryRun = true;
    else throw new Error(`不支持的参数：${a}（可用参数：--out、--ssh、--dir、--files-ssh、--files-dir、--github、--dry-run）`);
  }
  const host = /^[A-Za-z0-9._@-]+$/;
  if (!!o.ssh !== !!o.dir) throw new Error('--ssh 和 --dir 要一起写');
  if (o.ssh && !host.test(o.ssh)) throw new Error(`--ssh 只写主机名或 ssh 配置里的别名：${o.ssh}`);
  if (o.dir && !/^[A-Za-z]:[\\/][^'"`$;&|<>]*$/.test(o.dir)) throw new Error(`--dir 要写 Windows 的绝对路径，不能有引号和特殊字符：${o.dir}`);
  if (!!o.filesSsh !== !!o.filesDir) throw new Error('--files-ssh 和 --files-dir 要一起写');
  if (o.filesSsh && !host.test(o.filesSsh)) throw new Error(`--files-ssh 只写主机名或 ssh 配置里的别名：${o.filesSsh}`);
  if (o.filesDir && !/^\/[A-Za-z0-9._/-]+$/.test(o.filesDir)) throw new Error(`--files-dir 要写 Linux 的绝对路径，只能有字母、数字和 . _ - /：${o.filesDir}`);
  // 下载文件另放时，清单还是要有地方放（--ssh 的站点），不然 WebUI 读到的清单指不到新文件
  if (o.filesSsh && !o.ssh) throw new Error('--files-ssh 只放下载文件，还要用 --ssh/--dir 指定网站首页和 index.json 放在哪');
  if (!o.ssh && !o.github) throw new Error('要用 --ssh/--dir 或 --github 指定传到哪里');
  return o;
}

/** 服务器上已有的（相对路径 → 大小）和要发的比：同名同大小跳过，同名大小不同就停下，其余要传。 */
export function filesToUpload(files, have, where) {
  const todo = [];
  for (const f of files) {
    if (have.has(f.file)) {
      if (have.get(f.file) !== f.size) throw new Error(`${where}上已有 ${f.file}，大小不同（${have.get(f.file)}，这次 ${f.size}）；发布过的文件不能换内容`);
      continue;
    }
    todo.push(f.file);
  }
  return todo;
}

const parseListing = (text) => new Map(text.split(/\r?\n/).filter(Boolean).map((l) => { const i = l.lastIndexOf('|'); return [l.slice(0, i), Number(l.slice(i + 1))]; }));

/** 按清单算出要传的东西：服务器上的不变文件（相对路径和大小）、GitHub 上每个 Release 的文件。 */
export function publishPlan(index) {
  const files = [];
  const add = (file, size) => { if (!files.some((f) => f.file === file)) files.push({ file, size }); };
  const releases = [];
  const app = index.app;
  add(app.file, app.size); add(app.core.file, app.core.size);
  releases.push({ tag: app.tag, title: `mcbot ${app.version}`, notes: app.notes, files: [app.file, app.core.file], latest: true });
  for (const [id, p] of Object.entries(index.plugins ?? {})) {
    add(p.file, p.size);
    releases.push({ tag: p.tag, title: `${p.name || id} 插件 ${p.version}`, notes: p.notes, files: [p.file], latest: false });
  }
  return { files, releases };
}

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, ...opts });
  if (r.error) throw r.error;
  return r;
};
const must = (cmd, args, what) => {
  const r = run(cmd, args);
  if (r.status !== 0) throw new Error(`${what}失败（${cmd} 退出码 ${r.status}）：${(r.stderr || r.stdout || '').trim()}`);
  return r.stdout;
};
const psQuote = (s) => `'${s.replace(/'/g, "''")}'`;

function checkLocal(o, plan) {
  for (const f of plan.files) {
    const local = path.join(o.out, f.file);
    if (!fs.existsSync(local) || fs.statSync(local).size !== f.size) throw new Error(`发布目录里的 ${f.file} 不在或大小和清单不同，先重新运行 release.mjs`);
  }
}

/** 下载文件传到另一台 Linux 服务器（--files-ssh、--files-dir）：每个先传成 .part 再改名。 */
function publishFiles(o, plan, log) {
  const remote = (rel) => `${o.filesDir.replace(/\/$/, '')}/${rel}`;
  const listing = must('ssh', [o.filesSsh, `if [ -d '${o.filesDir}' ]; then cd '${o.filesDir}' && find . -type f ! -name '*.part' -printf '%P|%s\\n'; fi`], '读下载服务器目录');
  const todo = filesToUpload(plan.files, parseListing(listing), '下载服务器');
  log(`下载服务器 ${o.filesSsh}:${o.filesDir}：新传 ${todo.length} 个文件${todo.length ? `（${todo.join('、')}）` : ''}`);
  if (o.dryRun || !todo.length) return;
  const dirs = [...new Set(todo.map((f) => path.posix.dirname(f)))];
  must('ssh', [o.filesSsh, `mkdir -p ${dirs.map((d) => `'${remote(d)}'`).join(' ')}`], '建下载服务器目录');
  for (const f of todo) {
    log(`  上传 ${f}`);
    must('scp', ['-q', path.join(o.out, f), `${o.filesSsh}:${remote(f)}.part`], `上传 ${f} `);
    must('ssh', [o.filesSsh, `mv -f '${remote(f)}.part' '${remote(f)}'`], `改名 ${f} `);
  }
}

function publishServer(o, index, plan, log) {
  const remote = (rel) => `${o.dir.replace(/\\/g, '/').replace(/\/$/, '')}/${rel}`;
  // 下载文件另放时这里只换网站首页和 index.json
  let todo = [];
  if (!o.filesSsh) {
    // 服务器上已有的文件和大小
    const listing = must('ssh', [o.ssh, `if (Test-Path -LiteralPath ${psQuote(o.dir)}) { Get-ChildItem -LiteralPath ${psQuote(o.dir)} -Recurse -File | ForEach-Object { $_.FullName.Substring(${o.dir.replace(/[\\/]$/, '').length + 1}).Replace('\\','/') + '|' + $_.Length } }`], '读服务器目录');
    todo = filesToUpload(plan.files, parseListing(listing), '服务器');
  }
  const site = fs.existsSync(path.join(o.out, 'index.html'));
  log(`服务器 ${o.ssh}:${o.dir}：${o.filesSsh ? '下载文件在下载服务器' : `新传 ${todo.length} 个文件${todo.length ? `（${todo.join('、')}）` : ''}`}${site ? '，更新网站首页' : ''}，最后换 index.json`);
  if (o.dryRun) return;
  const dirs = [...new Set(todo.map((f) => path.posix.dirname(f)))];
  must('ssh', [o.ssh, `New-Item -ItemType Directory -Force -Path ${[o.dir, ...dirs.map((d) => remote(d))].map(psQuote).join(',')} | Out-Null`], '建服务器目录');
  for (const f of todo) {
    log(`  上传 ${f}`);
    must('scp', ['-q', path.join(o.out, f), `${o.ssh}:${remote(f)}`], `上传 ${f} `);
  }
  if (site) must('scp', ['-q', path.join(o.out, 'index.html'), `${o.ssh}:${remote('index.html')}`], '上传网站首页');
  must('scp', ['-q', path.join(o.out, 'index.json'), `${o.ssh}:${remote('index.json.tmp')}`], '上传 index.json');
  must('ssh', [o.ssh, `Move-Item -Force -LiteralPath ${psQuote(remote('index.json.tmp'))} -Destination ${psQuote(remote('index.json'))}`], '换 index.json');
}

function publishGithub(o, index, plan, log) {
  const sha = must('git', ['-C', ROOT, 'rev-parse', 'HEAD'], '读当前提交').trim();
  if (!o.dryRun) {
    must('git', ['-C', ROOT, 'fetch', '-q', 'origin'], '取远端');
    if (!must('git', ['-C', ROOT, 'branch', '-r', '--contains', sha], '查提交是否已推送').trim()) throw new Error(`当前提交 ${sha.slice(0, 7)} 还没推送到 GitHub，tag 打不上：先推送`);
  }
  const existing = (tag) => {
    const r = run('gh', ['release', 'view', tag, '-R', GITHUB_REPO, '--json', 'assets', '--jq', '.assets[] | "\\(.name)|\\(.size)"']);
    if (r.status !== 0) return null;
    return new Map(r.stdout.split(/\r?\n/).filter(Boolean).map((l) => { const i = l.lastIndexOf('|'); return [l.slice(0, i), Number(l.slice(i + 1))]; }));
  };
  const sizeOf = (file) => plan.files.find((f) => f.file === file).size;
  for (const rel of plan.releases) {
    const assets = existing(rel.tag);
    const missing = rel.files.filter((f) => {
      const name = path.posix.basename(f), size = assets?.get(name);
      if (size !== undefined && size !== sizeOf(f)) throw new Error(`GitHub 上 ${rel.tag} 的 ${name} 大小不同（${size}，这次 ${sizeOf(f)}）；发布过的文件不能换内容`);
      return size === undefined;
    });
    if (assets && !missing.length) continue;
    log(`GitHub ${rel.tag}：${assets ? '补传' : '新建，上传'} ${missing.map((f) => path.posix.basename(f)).join('、')}`);
    if (o.dryRun) continue;
    const paths = missing.map((f) => path.join(o.out, f));
    if (assets) must('gh', ['release', 'upload', rel.tag, ...paths, '-R', GITHUB_REPO], `上传 ${rel.tag} 的文件`);
    else must('gh', ['release', 'create', rel.tag, ...paths, '-R', GITHUB_REPO, '--target', sha, '--title', rel.title,
      '--notes', (rel.notes ?? []).map((n) => `- ${n}`).join('\n') || rel.title, `--latest=${rel.latest}`], `建 ${rel.tag}`);
  }
  log(`GitHub ${INDEX_TAG}：覆盖 index.json`);
  if (o.dryRun) return;
  if (!existing(INDEX_TAG)) must('gh', ['release', 'create', INDEX_TAG, '-R', GITHUB_REPO, '--target', sha, '--title', '更新清单',
    '--notes', 'mcbot 的 WebUI 从这里读总清单 index.json，每次发布覆盖。下载请看其他 Release。', '--latest=false'], `建 ${INDEX_TAG}`);
  must('gh', ['release', 'upload', INDEX_TAG, path.join(o.out, 'index.json'), '--clobber', '-R', GITHUB_REPO], '上传 index.json');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const o = parsePublishArgs(process.argv.slice(2));
    const index = JSON.parse(fs.readFileSync(path.join(o.out, 'index.json'), 'utf8'));
    const plan = publishPlan(index);
    if (o.dryRun) console.log('只列出要做的，不上传：');
    checkLocal(o, plan);
    // GitHub 先：服务器上的 index.json 一换，WebUI 就会去下载；GitHub 的文件先就位，服务器下载失败时才有备用。
    // 下载服务器在 index.json 所在的服务器之前，清单换了文件就已经在
    if (o.github) publishGithub(o, index, plan, console.log);
    if (o.filesSsh) publishFiles(o, plan, console.log);
    if (o.ssh) publishServer(o, index, plan, console.log);
    console.log(o.dryRun ? '（没有上传）' : `已发布主程序 ${index.app.version}`);
  } catch (e) { console.error(e.message); process.exit(1); }
}
