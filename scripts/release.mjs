#!/usr/bin/env node
// 生成发布用的目录：output/release/ 下摆成和服务器一样的 app/、core/、plugins/ 加总清单 index.json（格式见 docs/update_design.md 第四节）。
// 只生成，不上传：上传到服务器或 GitHub 是公开操作，要先问用户。
// 用法：node scripts/release.mjs --github-org <组织> --github-repo <仓库> [--notes <更新说明.json>] [--out output/release] [--installer <exe>] [--date YYYY-MM-DD]
// 先用 package.mjs 打好安装包、用 gradle 构建好核心和插件。版本和上一份 index.json（默认是 --out 里的那份）一样的部分整段沿用、不复制文件；
// 新版本的部分要在 --notes 里写更新说明：{ "app": ["……"], "plugins": { "<插件 id>": ["……"] }, "notices": [ 公告 ] }。
// plugins 从 compat.json 生成，先跑 check-compat。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { loadCompat, checkCompat, gradleProperty } from './check-compat.mjs';
import { parseVersion, compareVersions, readAppVersion } from './version.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SCHEMA = 1;
export const SERVER = 'https://mcbot.muxueuma.com/';
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseReleaseArgs(argv) {
  const o = { out: path.join(ROOT, 'output', 'release'), notes: '', installer: '', date: new Date().toLocaleDateString('sv-SE'), org: '', repo: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = () => { if (i + 1 >= argv.length) throw new Error(`${a} 后面要写值`); return argv[++i]; };
    if (a === '--out') o.out = path.resolve(v());
    else if (a === '--notes') o.notes = path.resolve(v());
    else if (a === '--installer') o.installer = path.resolve(v());
    else if (a === '--date') o.date = v();
    else if (a === '--github-org') o.org = v();
    else if (a === '--github-repo') o.repo = v();
    else throw new Error(`不支持的参数：${a}（可用参数：--github-org、--github-repo、--notes、--out、--installer、--date）`);
  }
  if (!NAME.test(o.org) || !NAME.test(o.repo)) throw new Error('要用 --github-org 和 --github-repo 写明 GitHub 的组织名和仓库名');
  if (!DATE.test(o.date)) throw new Error(`--date 要写成 YYYY-MM-DD：${o.date}`);
  return o;
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

function checkNotes(notes, what) {
  if (!Array.isArray(notes) || !notes.length || notes.some((n) => typeof n !== 'string' || !n.trim())) throw new Error(`${what} 是新版本，--notes 里要写更新说明（非空的字符串数组）`);
  return notes;
}

export function checkNotice(n) {
  const bad = (why) => { throw new Error(`公告 ${n?.id ?? '(没有 id)'}：${why}`); };
  if (!n || typeof n !== 'object') bad('不是对象');
  for (const k of ['id', 'date', 'title', 'text']) if (typeof n[k] !== 'string' || !n[k].trim()) bad(`缺 ${k}`);
  if (!DATE.test(n.date)) bad('date 要写成 YYYY-MM-DD');
  if (!['info', 'warn'].includes(n.level)) bad('level 只能是 info 或 warn');
  for (const k of ['appMin', 'appMax']) if (n[k] !== undefined) { try { parseVersion(n[k]); } catch { bad(`${k} 不是 0.0.1 这样的版本号`); } }
  if (n.until !== undefined && !DATE.test(n.until)) bad('until 要写成 YYYY-MM-DD');
  return n;
}

/**
 * 算出新的 index.json 和要摆进发布目录的文件。parts 是这次构建出来的主程序和插件（版本、文件、大小），prev 是上一份清单（可以没有）。
 * 版本没变的部分沿用上一份；变了的要比上一份新，要有更新说明。
 */
export function planRelease({ compat, app, plugins, prev, notes = {}, date, org, repo }) {
  const files = [], warnings = [];
  const fresh = (kind, id, built) => {
    const old = kind === 'app' ? prev?.app : prev?.plugins?.[id];
    if (old && old.version === built.version) {
      if (old.size !== built.size) warnings.push(`${id} 版本还是 ${built.version}，但这次构建的文件大小（${built.size}）和已发布的（${old.size}）不同。已发布的文件不能覆盖，改动要发出去就先用 set-version.mjs 提版本`);
      return null;
    }
    if (old && compareVersions(built.version, old.version) < 0) throw new Error(`${id} 的版本 ${built.version} 比上一份清单里的 ${old.version} 还旧`);
    return checkNotes(kind === 'app' ? notes.app : notes.plugins?.[id], id);
  };

  let appEntry;
  const appNotes = fresh('app', 'app', app);
  if (appNotes) {
    appEntry = {
      version: app.version, date, notes: appNotes,
      file: `app/${path.basename(app.installer)}`, tag: `app-v${app.version}`, size: app.size,
      core: { file: `core/${path.basename(app.core)}`, size: app.coreSize },
    };
    files.push({ from: app.installer, to: appEntry.file, size: app.size }, { from: app.core, to: appEntry.core.file, size: app.coreSize });
  } else {
    appEntry = prev.app;
    if (prev.app.core?.size !== app.coreSize) warnings.push(`核心版本还是 ${app.version}，但这次构建的 jar 大小（${app.coreSize}）和已发布的（${prev.app.core?.size}）不同。已发布的文件不能覆盖，改动要发出去就先提主程序版本`);
  }

  const pluginEntries = {};
  for (const adapter of compat.adapters.filter((a) => a.kind === 'addon')) {
    const built = plugins[adapter.id];
    const pluginNotes = fresh('plugin', adapter.id, built);
    // 其余字段照 compat.json 的写法（被适配模组的版本、Modrinth 地址等），去掉只在仓库里有意义的
    const { id, project, jar, kind, ...rest } = adapter;
    if (pluginNotes) {
      const file = `plugins/${path.basename(built.file)}`;
      pluginEntries[id] = { version: built.version, date, notes: pluginNotes, file, tag: `${id}-v${built.version}`, size: built.size, ...rest };
      files.push({ from: built.file, to: file, size: built.size });
    } else {
      const old = prev.plugins[id];
      // 已发布的 jar 里锁着被适配模组的版本；requires 变了而插件版本没提，清单就会把旧 jar 和新的下载地址配在一起
      if (!isDeepStrictEqual(old.requires, rest.requires)) throw new Error(`${id} 被适配模组的版本或下载信息变了，插件版本却还是 ${old.version}：先用 set-version.mjs 提插件版本再发布`);
      pluginEntries[id] = { version: old.version, date: old.date, notes: old.notes, file: old.file, tag: old.tag, size: old.size, ...rest, coreMin: old.coreMin };
      if (old.coreMin !== adapter.coreMin) warnings.push(`${id} 版本没变，coreMin 却从 ${old.coreMin} 改成了 ${adapter.coreMin}；已发布的 jar 里写的是旧值，清单照旧写 ${old.coreMin}`);
    }
  }
  const dropped = Object.keys(prev?.plugins ?? {}).filter((id) => !pluginEntries[id]);
  for (const id of dropped) warnings.push(`上一份清单里的插件 ${id} 已不在 compat.json 里，新清单不再列出它（已发布的文件保留）`);

  const notices = new Map((prev?.notices ?? []).map((n) => [n.id, n]));
  for (const n of notes.notices ?? []) notices.set(checkNotice(n).id, n);

  const index = {
    schema: SCHEMA, updated: date,
    sources: [SERVER, `https://github.com/${org}/${repo}/releases/download/`],
    app: appEntry,
    notices: [...notices.values()],
    plugins: pluginEntries,
  };
  return { index, files, warnings };
}

/** 读这次构建出来的东西：安装包、核心 jar、各插件 jar 的版本和大小；缺了说是哪个、怎么补。 */
export function collectBuilt(compat, installer) {
  const version = readAppVersion(ROOT);
  const need = (file, how) => { if (!fs.existsSync(file)) throw new Error(`缺 ${path.relative(ROOT, file)}（${how}）`); return fs.statSync(file).size; };
  const exe = installer || path.join(ROOT, 'output', 'package', `mcbot-setup-${version}.exe`);
  if (path.basename(exe) !== `mcbot-setup-${version}.exe`) throw new Error(`安装包文件名应为 mcbot-setup-${version}.exe：${exe}`);
  const core = path.join(ROOT, compat.core.project, 'build', 'libs', compat.core.jar);
  const app = { version, installer: exe, size: need(exe, '先运行 node scripts/package.mjs'), core, coreSize: need(core, '先在核心目录运行 gradlew build') };
  const plugins = {};
  for (const a of compat.adapters.filter((x) => x.kind === 'addon')) {
    const file = path.join(ROOT, a.project, 'build', 'libs', a.jar);
    plugins[a.id] = { version: gradleProperty(a.project, 'mod_version'), file, size: need(file, `先在 ${a.project} 运行 gradlew build（核心先构建）`) };
  }
  return { app, plugins };
}

/** 把新文件复制进发布目录，最后写 index.json。同名文件已经在而大小不同就停下：发布过的文件名不能换内容。 */
export function writeRelease(out, { index, files }) {
  for (const f of files) {
    const to = path.join(out, f.to);
    if (fs.existsSync(to)) {
      if (fs.statSync(to).size !== f.size) throw new Error(`${to} 已经存在且大小不同；发布过的文件名不能换内容，请先提版本`);
      continue;
    }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(f.from, to + '.tmp');
    fs.renameSync(to + '.tmp', to);
  }
  const file = path.join(out, 'index.json');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(index, null, 2) + '\n');
  fs.renameSync(file + '.tmp', file);
  return file;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const o = parseReleaseArgs(process.argv.slice(2));
    const compat = loadCompat();
    const problems = checkCompat(compat);
    if (problems.length) throw new Error(`compat.json 与代码不一致，请先修复：\n- ${problems.join('\n- ')}`);
    const prevFile = path.join(o.out, 'index.json');
    const prev = fs.existsSync(prevFile) ? readJson(prevFile) : null;
    if (prev && prev.schema > SCHEMA) throw new Error(`上一份清单的 schema 是 ${prev.schema}，比本脚本认识的 ${SCHEMA} 新`);
    const notes = o.notes ? readJson(o.notes) : {};
    const plan = planRelease({ compat, ...collectBuilt(compat, o.installer), prev, notes, date: o.date, org: o.org, repo: o.repo });
    const file = writeRelease(o.out, plan);
    for (const w of plan.warnings) console.warn(`注意：${w}`);
    console.log(`已生成 ${file}（主程序 ${plan.index.app.version}，插件 ${Object.keys(plan.index.plugins).length} 个，公告 ${plan.index.notices.length} 条）`);
    console.log(plan.files.length ? `这次新增的文件：\n- ${plan.files.map((f) => f.to).join('\n- ')}` : '没有新文件，只更新了 index.json');
    console.log('没有上传。上传到服务器或 GitHub 前要先问用户；服务器上先传文件、最后覆盖 index.json。');
  } catch (e) { console.error(e.message); process.exit(1); }
}
