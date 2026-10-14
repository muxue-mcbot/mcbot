// WebUI 的「插件」：按 compat.json 把核心模组和各个适配当成插件，装进或卸出选中的游戏目录。
// - 一个插件 = 我们的附属 jar（有的话）＋ 被适配的模组本体（确切版本）＋ 要写的配置（通用物品槽这类）。
// - 状态按实际文件判断：读 mods 里每个 jar 的 META-INF/neoforge.mods.toml 拿 mod id 和版本。我们自己的 jar 按版本比较
//   （docs/update_design.md 第八节）：核心要装的版本 = 主程序的版本；适配插件要装总清单 index.json（runtime/update-index.json，
//   webui-update.mjs 读的那份）里的最新版，前提是主程序满足它的 coreMin，没有清单就用 compat.json 里的版本。
// - 先出计划（下载什么、放进什么、移走什么、改哪个配置），网页确认后才执行。移走的旧文件和改之前的配置都放进
//   <游戏目录>/mcbot-backups/<时间>/，不删。第三方模组只从 compat.json（或清单）里写的 Modrinth 官方地址下载，大小对上才用；
//   我们自己的 jar 按来源顺序从更新服务器或 GitHub 下载（地址规则见 webui-update.mjs 的 fileUrl），大小和 mods.toml 里的
//   mod id、版本都对上才用。下好的留在 runtime/mod-downloads 下次直接用。仓库里有同名的本地构建时直接复制，方便开发。
// - 游戏或服务器开着时不改（Windows 上加载中的 jar 移不动，改了也要重启才生效）。
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { connectionFileOf, gameOnline, gameSupport, gameType } from './webui-games.mjs';
import { gameRunState, javaProcesses, runMessage } from './game-processes.mjs';
import { runtimeDir } from './paths.mjs';
import { compareVersions, parseVersion, readAppVersion } from './version.mjs';
import { cachedIndex, downloadFile, downloadSources, fileUrl, isGithubSource } from './webui-update.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_DIR = path.join('config', 'mcbot-server-control');
const ITEM_HANDLERS = path.join(CONFIG_DIR, 'item-handlers.json');
const MODRINTH_RE = /^https:\/\/cdn\.modrinth\.com\//;
const JAR_RE = /^[^\\/:*?"<>|\u0000-\u001f]+\.jar$/i;
const PLUGIN_FILE_RE = /^plugins\/[A-Za-z0-9._+-]+\.jar$/, TAG_RE = /^[A-Za-z0-9._+-]+$/;
// 10-14 定版本号方案之前，我们的 jar 一律写的 0.1.0（数字上比 0.0.x 大）：要装的版本低于 0.1.0 时把它当旧版。
// 正式发 0.1.0 以后这条自动不起作用；那时还留着方案之前 0.1.0 的游戏会被当成已是最新，见 docs/update_design.md 第八节。
const LEGACY_VERSION = '0.1.0';

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

// ---- 读 jar：只找中央目录里的一两个条目，不解整个包 ----

/** 从 zip（jar）里读出指定的几个文本条目；不是 zip 或读不了返回 null。 */
export function readZipEntries(file, names) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size, tail = Math.min(size, 65557), buf = Buffer.alloc(tail);
    fs.readSync(fd, buf, 0, tail, size - tail);
    let end = -1;
    for (let i = tail - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) { end = i; break; }
    if (end < 0) return null;
    const cdSize = buf.readUInt32LE(end + 12), cdOff = buf.readUInt32LE(end + 16);
    if (cdOff + cdSize > size) return null;
    const cd = Buffer.alloc(cdSize);
    fs.readSync(fd, cd, 0, cdSize, cdOff);
    const out = {};
    for (let p = 0; p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50;) {
      const method = cd.readUInt16LE(p + 10), csize = cd.readUInt32LE(p + 20), n = cd.readUInt16LE(p + 28);
      const skip = n + cd.readUInt16LE(p + 30) + cd.readUInt16LE(p + 32), local = cd.readUInt32LE(p + 42);
      const name = cd.toString('utf8', p + 46, p + 46 + n);
      if (names.includes(name) && (method === 0 || method === 8) && csize < 4 * 1024 * 1024) {
        const lh = Buffer.alloc(30);
        fs.readSync(fd, lh, 0, 30, local);
        if (lh.readUInt32LE(0) !== 0x04034b50) return null;
        const data = Buffer.alloc(csize);
        fs.readSync(fd, data, 0, csize, local + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28));
        out[name] = (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8');
      }
      p += 46 + skip;
    }
    return out;
  } catch { return null; } finally { if (fd !== undefined) fs.closeSync(fd); }
}

/** neoforge.mods.toml 里 [[mods]] 段的 modId 和 version；version 是 ${file.jarVersion} 时用 MANIFEST 的 Implementation-Version。 */
export function modsInToml(toml, manifest = '') {
  const jarVersion = /^Implementation-Version:\s*(.+)$/m.exec(manifest)?.[1]?.trim() || '';
  const out = [];
  let cur = null;
  for (const line of String(toml).split(/\r?\n/)) {
    const t = line.trim();
    // A table header may carry a comment: Iron Furnaces writes `[[mods]] #mandatory`.
    if (t.startsWith('[')) { cur = t.replace(/\s*#.*$/, '') === '[[mods]]' ? {} : null; if (cur) out.push(cur); continue; }
    const m = cur && /^(modId|version)\s*=\s*["']([^"']*)["']/.exec(t);
    if (m) cur[m[1]] = m[2];
  }
  return out.filter((m) => m.modId).map((m) => ({ modId: m.modId, version: m.version === '${file.jarVersion}' ? jarVersion : (m.version || '') }));
}

const scanCache = new Map();
/** mods 文件夹里每个 jar 声明的模组；按文件大小和修改时间缓存。 */
export function scanMods(gameDir) {
  const dir = path.join(gameDir, 'mods');
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => /\.jar$/i.test(n)); } catch { return []; }
  return names.sort().map((file) => {
    const full = path.join(dir, file);
    let st;
    try { st = fs.statSync(full); } catch { return { file, mods: [] }; }
    const key = full.toLowerCase(), hit = scanCache.get(key);
    if (hit && hit.size === st.size && hit.mtime === st.mtimeMs) return { file, mods: hit.mods };
    const e = readZipEntries(full, ['META-INF/neoforge.mods.toml', 'META-INF/MANIFEST.MF']) || {};
    const mods = modsInToml(e['META-INF/neoforge.mods.toml'] || '', e['META-INF/MANIFEST.MF'] || '');
    scanCache.set(key, { size: st.size, mtime: st.mtimeMs, mods });
    return { file, mods };
  });
}

// ---- 插件目录：从 compat.json 来 ----

/** 包里我们自己的 jar：绿色版在 mods/，仓库里在模组的构建目录。 */
export function packageJar(root, entry) {
  if (!entry?.jar) return '';
  return [path.join(root, 'mods', entry.jar), entry.project ? path.join(root, entry.project, 'build', 'libs', entry.jar) : ''].find((p) => p && isFile(p)) || '';
}
/** 我们的 jar 的 mod id：项目名去掉连字符（mcbot-kaleidoscope-cookery → mcbot_kaleidoscope_cookery），核心就是 core.id。 */
const ourModId = (entry) => entry.kind === 'core' ? entry.id : path.basename(entry.project || '').replace(/-/g, '_');

const isVersion = (v) => { try { parseVersion(v); return true; } catch { return false; } };
/** jar 文件名里的版本：mcbot-iron-furnaces-0.0.3.jar → 0.0.3。 */
export const jarVersion = (jar) => /-(\d+\.\d+\.\d+)\.jar$/i.exec(String(jar || ''))?.[1] || '';
/** 已安装的版本和要装的比：-1 旧、0 相同、1 新。读不出版本的当旧版；方案之前的 0.1.0 见 LEGACY_VERSION。 */
export function compareInstalled(have, want) {
  if (!isVersion(have)) return -1;
  if (have === LEGACY_VERSION && compareVersions(want, LEGACY_VERSION) < 0) return -1;
  return compareVersions(have, want);
}
/** 清单里一个插件的发布信息；格式不对返回 null。 */
function releasedPlugin(r) {
  if (!r || typeof r !== 'object' || !isVersion(r.version) || !PLUGIN_FILE_RE.test(String(r.file)) || !TAG_RE.test(String(r.tag))
    || !(Number.isSafeInteger(r.size) && r.size > 0) || (r.coreMin !== undefined && !isVersion(r.coreMin))) return null;
  // 和 compat.json 写法相同的字段会合进插件目录：类型不对的整条忽略（退回 compat.json 的版本），不能让插件页打不开
  const str = (v) => v === undefined || typeof v === 'string';
  const strs = (v) => v === undefined || (Array.isArray(v) && v.every((s) => typeof s === 'string'));
  const req = (q) => q && typeof q === 'object' && (typeof q.ref === 'string' || (typeof q.modId === 'string' && typeof q.version === 'string' && str(q.side) && str(q.license)
    && (q.modrinth === undefined || (q.modrinth && typeof q.modrinth === 'object' && typeof q.modrinth.file === 'string' && typeof q.modrinth.url === 'string' && Number.isSafeInteger(q.modrinth.size)))));
  if (![r.name, r.nameEn, r.evidence].every(str) || !strs(r.what) || !(r.requires === undefined || (Array.isArray(r.requires) && r.requires.every(req)))) return null;
  return { version: r.version, file: r.file, tag: r.tag, size: r.size, coreMin: r.coreMin || '', date: typeof r.date === 'string' ? r.date : '',
    notes: Array.isArray(r.notes) ? r.notes.filter((s) => typeof s === 'string') : [] };
}

/**
 * 插件目录：compat.json 给出有哪些插件、各要哪些模组本体；我们的 jar 要装哪个版本、从哪里下载按主程序版本和清单定。
 * 核心：版本 = 主程序版本，地址按规则拼（core/<jar>、app-v<版本>），清单里正好是这个版本时带上大小。
 * 适配插件：清单里有更新的版本、主程序满足 coreMin 时改装清单里的（连同它要的模组本体和配置）；不满足时记下 needApp。
 */
export function loadCatalog(root = ROOT, { runtime = runtimeDir(root), cache = cachedIndex(runtime) } = {}) {
  const compat = readJson(path.join(root, 'compat.json'));
  if (!compat?.core || !Array.isArray(compat.adapters)) throw new Error('compat.json 无法读取');
  let appVersion;
  try { appVersion = readAppVersion(root); } catch { appVersion = jarVersion(compat.core.jar); }
  const index = cache?.index || null;
  const mod = (r) => ({ modId: r.modId, version: r.version, side: r.side || 'both', license: r.license || '', project: r.modrinth?.project || '',
    file: r.modrinth?.file || '', size: r.modrinth?.size || 0, url: r.modrinth?.url || '' });
  const core = { id: compat.core.id, kind: 'core', name: compat.core.name, what: [compat.core.what], jar: compat.core.jar, project: compat.core.project, mods: [], needs: [],
    version: appVersion, remote: { file: `core/${compat.core.jar}`, tag: `app-v${appVersion}`, size: 0 } };
  const ic = index?.app?.core;
  if (ic && index.app.version === appVersion && path.posix.basename(ic.file) === core.jar) core.remote = { file: ic.file, tag: index.app.tag, size: ic.size };
  core.modId = ourModId(core); core.src = packageJar(root, core);
  const adapters = compat.adapters.map((a) => {
    if (a.kind !== 'addon') return { a };
    const local = jarVersion(a.jar), out = { a, version: local, remote: { file: `plugins/${a.jar}`, tag: `${a.id}-v${local}`, size: 0 } };
    const r = releasedPlugin(index?.plugins?.[a.id]);
    if (!r || !isVersion(local)) return out;
    const cmp = compareVersions(r.version, local);
    if (cmp < 0) return out;
    if (r.coreMin && compareVersions(appVersion, r.coreMin) < 0) return cmp > 0 ? { ...out, needApp: { version: r.version, coreMin: r.coreMin } } : out;
    // 清单里的条目带着和 compat.json 一样的字段（被适配模组的版本、Modrinth 地址、配置），版本更新时一起换
    const raw = index.plugins[a.id];
    const merged = cmp > 0 ? { ...a, ...Object.fromEntries(['name', 'nameEn', 'what', 'evidence', 'requires'].filter((k) => raw[k] !== undefined).map((k) => [k, raw[k]])), jar: path.posix.basename(r.file) } : a;
    return { a: merged, version: r.version, remote: { file: r.file, tag: r.tag, size: r.size }, date: r.date, notes: r.notes };
  });
  const byId = new Map(adapters.map(({ a }) => [a.id, a]));
  const plugins = adapters.map(({ a, ...rel }) => {
    const p = { id: a.id, kind: a.kind, name: a.name, nameEn: a.nameEn || '', what: a.what || [], evidence: a.evidence || '', jar: a.kind === 'addon' ? a.jar : '', project: a.project || '',
      mods: (a.requires || []).filter((r) => r.modId).map(mod), needs: (a.requires || []).filter((r) => r.ref && byId.has(r.ref)).map((r) => r.ref),
      config: a.kind === 'config' ? { file: ITEM_HANDLERS, mods: { ...(a.config?.mods || {}) } } : null, ...rel };
    p.modId = p.jar ? ourModId(p) : ''; p.src = p.jar ? packageJar(root, p) : '';
    return p;
  });
  return { minecraft: compat.platform?.minecraft || '', loader: compat.platform?.loader || '', platform: compat.platform || null, appVersion,
    manifestAt: cache?.checkedAt || 0, core, plugins };
}

/** 一个插件要的所有模组本体：自己的，加上它引用的插件的（比如「森罗厨房的机器」要森罗厨房本体）。 */
function modsNeeded(catalog, p, seen = new Set()) {
  if (seen.has(p.id)) return [];
  seen.add(p.id);
  const out = [...p.mods];
  for (const ref of p.needs) { const q = catalog.plugins.find((x) => x.id === ref); if (q) out.push(...modsNeeded(catalog, q, seen)); }
  return out.filter((m, i) => out.findIndex((x) => x.modId === m.modId) === i);
}

// ---- 状态 ----

function modState(scan, m) {
  const hits = scan.filter((j) => j.mods.some((x) => x.modId === m.modId));
  const exact = hits.find((j) => j.mods.some((x) => x.modId === m.modId && x.version === m.version));
  if (exact) return { state: 'ok', file: exact.file, version: m.version };
  if (hits.length) return { state: 'wrong', file: hits[0].file, version: hits[0].mods.find((x) => x.modId === m.modId).version, files: hits.map((j) => j.file) };
  return { state: 'missing' };
}
/**
 * 我们的 jar 的状态：missing 未安装；old 比要装的旧；newer 比要装的新；different 装了不止一个，
 * 或版本相同但和仓库里的本地构建字节不同（开发时重新构建过）；ok。version 是游戏里装的版本，want 是要装的。
 */
function jarState(gameDir, scan, entry) {
  const hits = scan.filter((j) => j.mods.some((x) => x.modId === entry.modId) || j.file.toLowerCase() === entry.jar.toLowerCase());
  if (!hits.length) return { state: 'missing', want: entry.version };
  const files = hits.map((j) => j.file);
  const base = { file: files[0], files, version: hits[0].mods.find((x) => x.modId === entry.modId)?.version || '', want: entry.version };
  if (hits.length > 1) return { state: 'different', ...base };
  const cmp = compareInstalled(base.version, entry.version);
  if (cmp) return { state: cmp < 0 ? 'old' : 'newer', ...base };
  if (entry.src) {
    let same = false;
    try { same = fs.readFileSync(path.join(gameDir, 'mods', hits[0].file)).equals(fs.readFileSync(entry.src)); } catch { /* 读不了算不同 */ }
    if (!same) return { state: 'different', ...base };
  }
  return { state: 'ok', ...base };
}
function readItemHandlers(gameDir) {
  const file = path.join(gameDir, ITEM_HANDLERS);
  if (!fs.existsSync(file)) return { exists: false, data: null };
  const data = readJson(file);
  return { exists: true, data: data && typeof data === 'object' && !Array.isArray(data) ? data : null };
}
function configState(gameDir, p) {
  const ih = readItemHandlers(gameDir);
  if (ih.exists && !ih.data) return { state: 'broken' };
  const have = ih.data?.mods || {};
  const pairs = Object.entries(p.config.mods);
  if (pairs.every(([m, v]) => have[m] === v)) return { state: 'ok' };
  if (pairs.some(([m]) => m in have)) return { state: 'wrong' };
  return { state: 'missing' };
}

/**
 * 每个插件的组成部分和状态。overall：ok 都对；none 关键部分没装；update 只是我们的 jar 有新版本；fix 装了但有缺的或版本不对。
 * 适配插件装的比要装的新（清单比游戏里的旧）算 ok；核心比主程序新算 fix，但不能在这里装（coreNewer，要先更新主程序）。
 */
export function inspectPlugins(gameDir, catalog = loadCatalog()) {
  const scan = scanMods(gameDir);
  const describe = (p) => {
    const parts = [];
    if (p.jar) parts.push({ kind: 'jar', label: p.kind === 'core' ? p.name : 'MCBOT 适配', file: p.jar, ...jarState(gameDir, scan, p), from: p.src ? 'package' : 'download' });
    for (const m of modsNeeded(catalog, p)) parts.push({ kind: 'mod', label: m.modId, modId: m.modId, want: m.version, side: m.side, download: { file: m.file, size: m.size }, ...modState(scan, m) });
    if (p.config) parts.push({ kind: 'config', label: '通用物品槽配置', file: p.config.file.replace(/\\/g, '/'), ...configState(gameDir, p) });
    const key = p.jar ? parts[0] : p.config ? parts[parts.length - 1] : parts[0];
    const good = (x) => x.state === 'ok' || (x.kind === 'jar' && x.state === 'newer' && p.kind !== 'core');
    const rest = parts.filter((x) => x !== parts[0] || !p.jar);
    const overall = parts.every(good) ? 'ok' : !key || key.state === 'missing' ? 'none' : p.jar && parts[0].state === 'old' && rest.every(good) ? 'update' : 'fix';
    const coreNewer = p.kind === 'core' && parts[0].state === 'newer';
    return { id: p.id, kind: p.kind, name: p.name, nameEn: p.nameEn || '', what: p.what, evidence: p.evidence || '', overall, parts,
      version: p.version || '', notes: overall === 'update' ? p.notes || [] : [], date: p.date || '', needApp: p.needApp || null, coreNewer,
      canInstall: overall !== 'ok' && !coreNewer, canUninstall: p.kind !== 'core' && overall !== 'none' };
  };
  const core = describe(catalog.core);
  // 所有插件都依赖核心：核心未安装或为旧版本时，插件多一项「核心模组」，不能显示为已安装
  const withCore = (d) => {
    if (core.overall === 'ok') return d;
    const parts = [...d.parts, { kind: 'core', label: '核心模组', file: catalog.core.jar, state: core.parts[0].state }];
    const overall = d.overall === 'none' ? 'none' : core.overall === 'update' && ['ok', 'update'].includes(d.overall) ? 'update' : 'fix';
    return { ...d, parts, overall, canInstall: true, canUninstall: d.canUninstall };
  };
  return { minecraft: catalog.minecraft, core, plugins: catalog.plugins.map((p) => withCore(describe(p))) };
}

// ---- 「给 AI 用」开关：按游戏目录存在 runtime/webui-plugins.json（WebUI 自己的数据，不写进游戏目录） ----
// 关掉的插件 id 在下次启动托管时经 start-server-play → mcp.json → 运行端（--disabled-plugins）生效；游戏和服务端模组不变，玩家照常用。

const AI_FILE = 'webui-plugins.json';
const sameDir = (a, b) => path.normalize(String(a)).toLowerCase() === path.normalize(String(b)).toLowerCase();
function readAiFile(runtime) {
  const data = readJson(path.join(runtime, AI_FILE));
  return Array.isArray(data?.games) ? data.games.filter((g) => g && typeof g.dir === 'string' && Array.isArray(g.disabled)) : [];
}
/** 此游戏对 AI 关闭的插件；只返回 compat.json 里还有的插件（清单删掉的插件自动失效）。默认全部开启。 */
export function disabledPlugins(runtime, gameDir, catalog = loadCatalog()) {
  const known = new Set(catalog.plugins.map((p) => p.id));
  const entry = readAiFile(runtime).find((g) => sameDir(g.dir, gameDir));
  return [...new Set((entry?.disabled || []).filter((id) => typeof id === 'string' && known.has(id)))].sort();
}
/** 打开或关闭一个插件的「给 AI 用」；核心模组没有开关。 */
export function setPluginAi(runtime, gameDir, id, enabled, catalog = loadCatalog()) {
  if (!catalog.plugins.some((p) => p.id === id)) return { ok: false, error: '插件不存在' };
  if (typeof enabled !== 'boolean') return { ok: false, error: '开关状态须为布尔值' };
  const games = readAiFile(runtime).filter((g) => !sameDir(g.dir, gameDir));
  const set = new Set(disabledPlugins(runtime, gameDir, catalog));
  if (enabled) set.delete(id); else set.add(id);
  if (set.size) games.push({ dir: path.normalize(gameDir), disabled: [...set].sort() });
  fs.mkdirSync(runtime, { recursive: true });
  const file = path.join(runtime, AI_FILE), tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, games }, null, 2) + '\n'); fs.renameSync(tmp, file);
  return { ok: true, disabled: [...set].sort() };
}

// ---- 计划和执行 ----

const fmtSize = (n) => (n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
const cached = (downloads, m) => { const f = path.join(downloads, m.file); try { return fs.statSync(f).size === m.size ? f : ''; } catch { return ''; } };
/** 下载的 jar 是不是声明了这个 mod id 和版本（我们的 jar 下载后、用缓存前都查）。 */
export function jarDeclares(file, modId, version) {
  const e = readZipEntries(file, ['META-INF/neoforge.mods.toml', 'META-INF/MANIFEST.MF']);
  return !!e && modsInToml(e['META-INF/neoforge.mods.toml'] || '', e['META-INF/MANIFEST.MF'] || '').some((m) => m.modId === modId && m.version === version);
}
const cachedOurs = (downloads, entry) => {
  const f = path.join(downloads, entry.jar);
  try { if (entry.remote.size && fs.statSync(f).size !== entry.remote.size) return false; } catch { return false; }
  return jarDeclares(f, entry.modId, entry.version);
};
const ACTIONS = ['install', 'uninstall', 'update-all', 'remove-all'];
const ALL_NAMES = { 'update-all': '全部更新', 'remove-all': '从此游戏移除 mcbot' };

/**
 * 装或卸插件要做的事。action：install（安装、更新或修复一个插件）、uninstall、update-all（核心加上所有已安装的插件）、
 * remove-all（移走核心、所有适配 jar 和 config/mcbot-server-control/，被适配的模组本体保留）。steps 里每一步：
 * download（下载到缓存：第三方从 Modrinth，我们的按 urls 顺序）、add（放进 mods）、remove（从 mods 移到备份）、
 * remove-dir（把整个目录移到备份）、config（改通用物品槽配置）。notes 是给人看的提醒；error 表示现在不能做。
 */
export function planPlugin(gameDir, id, action, { catalog = loadCatalog(), runtime = runtimeDir(), downloads = path.join(runtime, 'mod-downloads'),
  sources = downloadSources(cachedIndex(runtime)) } = {}) {
  if (!ACTIONS.includes(action)) return { ok: false, error: '不支持的操作' };
  const whole = action === 'update-all' || action === 'remove-all';
  const target = whole ? null : id === catalog.core.id ? catalog.core : catalog.plugins.find((p) => p.id === id);
  if (!whole && !target) return { ok: false, error: '插件不存在' };
  // 版本不在支持范围内的游戏不装：1.21.1 的模组放进别的版本会使游戏无法启动
  const support = gameSupport(gameDir, catalog.platform);
  if ((action === 'install' || action === 'update-all') && support.supported === false) return { ok: false, error: `${support.reason}。此游戏无法安装插件` };
  const status = inspectPlugins(gameDir, catalog);
  const infoOf = (p) => (p === catalog.core ? status.core : status.plugins.find((x) => x.id === p.id));
  const steps = [], notes = [], server = gameType(gameDir) === 'server';
  const has = (op, file) => steps.some((s) => s.op === op && s.file === file);
  const removeFiles = (files, why) => { for (const f of files || []) if (!has('remove', f)) steps.push({ op: 'remove', file: f, why }); };
  const note = (text) => { if (!notes.includes(text)) notes.push(text); };

  // 我们的 jar：本地有同名构建（仓库里）就复制，没有就从更新服务器或 GitHub 下载
  const ourJar = (entry, part, label) => {
    if (part.state === 'ok' || (part.state === 'newer' && entry !== catalog.core)) return '';
    if (part.state === 'newer') return `游戏中的核心模组（${part.version}）比主程序（${entry.version}）新：请先更新主程序`;
    removeFiles(part.files, part.state === 'different' && part.version === entry.version ? '需重新安装' : `${part.version || '旧版本'}，更换为 ${entry.version}`);
    if (has('add', entry.jar)) return '';
    if (!entry.src && !cachedOurs(downloads, entry)) {
      if (!sources.length) return '没有可用的下载地址';
      steps.push({ op: 'download', ours: true, modId: entry.modId, version: entry.version, file: entry.jar, size: entry.remote.size,
        sizeText: entry.remote.size ? fmtSize(entry.remote.size) : '', urls: sources.map((s) => fileUrl(s, entry.remote)), source: 'mcbot 更新服务器' });
    }
    steps.push({ op: 'add', file: entry.jar, from: entry.src ? 'package' : 'download', label });
    return '';
  };
  const installSteps = (t) => {
    const info = infoOf(t);
    // 所有插件都依赖核心（内置适配、配置类插件也一样）：核心未安装或为旧版本时一并安装
    if (t !== catalog.core) { const e = ourJar(catalog.core, status.core.parts[0], '核心模组'); if (e) return e; }
    if (t.jar) { const e = ourJar(t, info.parts[0], t === catalog.core ? '核心模组' : `${t.name}适配`); if (e) return e; }
    for (const part of info.parts.filter((x) => x.kind === 'mod' && x.state !== 'ok')) {
      const m = modsNeeded(catalog, t).find((x) => x.modId === part.modId);
      if (!m.url || !MODRINTH_RE.test(m.url) || !JAR_RE.test(m.file) || !(m.size > 0)) return `${m.modId} 缺少官方下载信息`;
      removeFiles(part.state === 'wrong' ? part.files : [], `${m.modId} ${part.version}，需更换为 ${m.version}`);
      if (!has('add', m.file)) {
        if (!cached(downloads, m)) steps.push({ op: 'download', modId: m.modId, version: m.version, file: m.file, size: m.size, sizeText: fmtSize(m.size), urls: [m.url], source: 'Modrinth', license: m.license });
        steps.push({ op: 'add', file: m.file, from: 'download', label: `${m.modId} ${m.version}` });
      }
      if (server && m.side === 'both') note(`${m.modId} 客户端也需安装：加入此服务器的玩家需在自己的游戏中安装 ${m.file}`);
    }
    const cfg = info.parts.find((x) => x.kind === 'config');
    if (cfg?.state === 'broken') return `${cfg.file} 无法读取，请先修复或删除该文件`;
    if (cfg && cfg.state !== 'ok' && !has('config', cfg.file)) steps.push({ op: 'config', file: cfg.file, set: { ...t.config.mods } });
    else if (cfg && cfg.state !== 'ok') Object.assign(steps.find((s) => s.op === 'config' && s.file === cfg.file).set, t.config.mods);
    return '';
  };

  if (action === 'install') {
    const e = installSteps(target);
    if (e) return { ok: false, error: e };
    // 换了核心时，已安装的旧版适配也一起换：旧适配的 mods.toml 要求核心不低于它当时的版本（比如方案之前的 [0.1.0,)），
    // 新核心不满足时 NeoForge 拒绝加载，游戏起不来
    if (has('add', catalog.core.jar)) {
      for (const t of catalog.plugins.filter((p) => p !== target && p.jar && ['old', 'different'].includes(infoOf(p).parts[0].state))) {
        const e2 = installSteps(t);
        if (e2) return { ok: false, error: `${t.name}：${e2}` };
        note(`更换核心模组后，已安装的${t.name}适配为旧版本，将一并更新`);
      }
    }
  } else if (action === 'update-all') {
    // 核心加上所有已安装的插件（没装的不装）；只差主程序版本的插件（needApp）不在这里处理
    for (const t of [catalog.core, ...catalog.plugins]) {
      const info = infoOf(t);
      if (info.overall === 'ok' || (t !== catalog.core && info.overall === 'none')) continue;
      const e = installSteps(t);
      if (e) return { ok: false, error: t === catalog.core ? e : `${t.name}：${e}` };
    }
  } else if (action === 'remove-all') {
    removeFiles(status.core.parts[0].files, '移除核心模组');
    for (const t of catalog.plugins) if (t.jar) removeFiles(infoOf(t).parts[0].files, `移除${t.name}适配`);
    if (fs.existsSync(path.join(gameDir, CONFIG_DIR))) steps.push({ op: 'remove-dir', file: CONFIG_DIR.replace(/\\/g, '/'), why: 'mcbot 的配置：Bot 名称、端口、连接文件和通用物品槽配置' });
    const kept = [...new Set(status.plugins.flatMap((p) => p.parts).filter((x) => x.kind === 'mod' && x.state !== 'missing').map((x) => x.modId))];
    if (kept.length) note(`${kept.join('、')} 本体将保留（世界中可能存在其方块和物品）；如需移除，请手动从 mods 中移走`);
  } else {
    const info = infoOf(target);
    if (!info.canUninstall) return { ok: false, error: target === catalog.core ? '核心模组不支持在此卸载' : '尚未安装' };
    if (target.jar) removeFiles(info.parts[0].files, '卸载适配');
    const cfg = info.parts.find((x) => x.kind === 'config');
    if (cfg && cfg.state !== 'missing') {
      if (cfg.state === 'broken') return { ok: false, error: `${cfg.file} 无法读取，请先修复或删除该文件` };
      steps.push({ op: 'config', file: cfg.file, unset: Object.keys(target.config.mods) });
    }
    const kept = info.parts.filter((x) => x.kind === 'mod' && x.state !== 'missing').map((x) => x.modId);
    if (kept.length) note(`${kept.join('、')} 本体将保留（世界中可能存在其方块和物品）；如需移除，请手动从 mods 中移走`);
  }
  if (!steps.length) return { ok: true, id, action, steps, notes, nothing: true };
  note(server ? '修改后需重启服务器才能生效' : '修改后需重启游戏才能生效');
  if (steps.some((s) => s.op === 'remove' || s.op === 'remove-dir' || (s.op === 'config' && fs.existsSync(path.join(gameDir, s.file))))) note('被替换的文件和修改前的配置将备份到游戏目录的 mcbot-backups 中');
  if (steps.some((s) => s.op === 'download' && s.ours)) note(sources.some(isGithubSource) ? 'mcbot 的模组从 mcbot 更新服务器下载，无法连接时改从 GitHub 下载；需要联网' : 'mcbot 的模组从 mcbot 更新服务器下载；需要联网');
  return { ok: true, id, action, name: whole ? ALL_NAMES[action] : target.name, steps, notes, downloadBytes: steps.filter((s) => s.op === 'download').reduce((n, s) => n + (s.size || 0), 0) };
}

/** 下载一步：按 urls 顺序试，一个失败换下一个；我们的 jar 还要核对 mods.toml 里的 mod id 和版本。 */
async function download(step, downloads, fetchImpl, progress) {
  const dest = path.join(downloads, step.file);
  let error = '', mismatch = '';
  for (const url of step.urls) {
    try {
      await downloadFile(url, dest, step.size, { fetchImpl, progress });
      if (step.ours && !jarDeclares(dest, step.modId, step.version)) { fs.rmSync(dest, { force: true }); mismatch = '文件内容与清单不符，已放弃使用'; continue; }
      return;
    } catch (e) {
      error = e.code && !e.message.includes('HTTP') ? `无法写入下载缓存（${e.code}）：请检查 ${downloads} 是否可写`
        : e.message.startsWith('fetch failed') ? (step.ours ? '无法连接 mcbot 更新服务器和 GitHub：需要联网才能安装模组' : '无法连接 Modrinth') : e.message;
    }
  }
  // 有来源给了内容不对的文件时报这个，比后面某个来源连不上更说明问题
  throw new Error(`下载 ${step.file} 失败：${mismatch || error}`);
}

const stamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

/** 改通用物品槽配置：只加或删这个插件的条目，其余原样保留。 */
function editItemHandlers(gameDir, step) {
  const file = path.join(gameDir, ITEM_HANDLERS), ih = readItemHandlers(gameDir);
  if (ih.exists && !ih.data) throw new Error(`${step.file} 无法读取`);
  const data = ih.data || { note: '由 mcbot WebUI 的插件页写入' };
  const mods = { ...(data.mods || {}) };
  for (const [m, v] of Object.entries(step.set || {})) mods[m] = v;
  for (const m of step.unset || []) delete mods[m];
  data.mods = mods;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n'); fs.renameSync(tmp, file);
}

/**
 * 执行一份重新算出来的计划（不信网页传来的步骤）。顺序：先下载（不碰游戏），再把要移走的挪进备份，
 * 再放新文件、改配置；中途出错就把放进去的拿掉、移走的放回来。
 */
export async function applyPlugin(gameDir, id, action, { catalog = loadCatalog(), runtime = runtimeDir(), downloads = path.join(runtime, 'mod-downloads'), fetchImpl = fetch,
  sources = downloadSources(cachedIndex(runtime)), online = (dir) => gameOnline(connectionFileOf(dir)), listProcesses = javaProcesses, progress = () => {}, now = new Date() } = {}) {
  const plan = planPlugin(gameDir, id, action, { catalog, runtime, downloads, sources });
  if (!plan.ok || plan.nothing) return plan;
  // 游戏在启动、加载模组或世界里都不改文件；下载要等一阵，所以放文件前还要再查一次
  const running = async () => runMessage((await gameRunState(gameDir, { online, listProcesses })).state, gameType(gameDir));
  const busy = await running();
  if (busy) return { ok: false, error: busy };
  const total = plan.downloadBytes || 0;
  let done = 0;
  for (const s of plan.steps.filter((x) => x.op === 'download')) {
    progress({ phase: 'download', file: s.file, bytes: done, total });
    try { await download(s, downloads, fetchImpl, (got) => progress({ phase: 'download', file: s.file, bytes: done + got, total })); }
    catch (e) { return { ok: false, error: e.message }; }
    done += s.size || 0;
  }
  const busyAgain = await running();
  if (busyAgain) return { ok: false, error: busyAgain };
  progress({ phase: 'files' });
  const mods = path.join(gameDir, 'mods'), backup = path.join(gameDir, 'mcbot-backups', stamp(now));
  const moved = [], added = [], configs = [], tmps = [], dirs = [];
  const all = [...catalog.plugins, catalog.core];
  try {
    for (const s of plan.steps) {
      if (s.op === 'remove') {
        fs.mkdirSync(path.join(backup, 'mods'), { recursive: true });
        fs.renameSync(path.join(mods, s.file), path.join(backup, 'mods', s.file));
        moved.push(s.file);
      } else if (s.op === 'add') {
        const src = s.from === 'package' ? all.find((p) => p.jar === s.file)?.src : path.join(downloads, s.file);
        if (!src || !isFile(src)) throw new Error(`未找到待复制的文件 ${s.file}`);
        fs.mkdirSync(mods, { recursive: true });
        const dest = path.join(mods, s.file);
        if (fs.existsSync(dest)) { fs.mkdirSync(path.join(backup, 'mods'), { recursive: true }); fs.renameSync(dest, path.join(backup, 'mods', s.file)); moved.push(s.file); }
        tmps.push(`${dest}.tmp`);
        fs.copyFileSync(src, `${dest}.tmp`); fs.renameSync(`${dest}.tmp`, dest);
        added.push(s.file);
      } else if (s.op === 'remove-dir') {
        const to = path.join(backup, s.file);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.renameSync(path.join(gameDir, s.file), to);
        dirs.push(s.file);
      } else if (s.op === 'config') {
        const file = path.join(gameDir, ITEM_HANDLERS);
        if (fs.existsSync(file)) { fs.mkdirSync(path.join(backup, path.dirname(ITEM_HANDLERS)), { recursive: true }); fs.copyFileSync(file, path.join(backup, ITEM_HANDLERS)); configs.push(true); }
        else configs.push(false);
        editItemHandlers(gameDir, s);
      }
    }
  } catch (e) {
    // 回滚每一步都可能失败（Windows 上文件被游戏占用时尤其常见）：失败的记下来，没全部恢复就不能说“已恢复原状”
    const failed = [];
    const stuckNew = new Map();
    for (const tmp of tmps) { try { fs.rmSync(tmp, { force: true }); } catch { /* 半截的临时文件不是 .jar，留着不会被游戏加载 */ } }
    for (const f of added) {
      try { fs.rmSync(path.join(mods, f), { force: true }); } catch { stuckNew.set(f, { file: `mods/${f}`, fix: 'delete' }); }
    }
    for (const f of moved) {
      try { fs.renameSync(path.join(backup, 'mods', f), path.join(mods, f)); stuckNew.delete(f); } catch { failed.push({ file: `mods/${f}`, fix: 'restore' }); }
    }
    failed.push(...stuckNew.values());
    for (const d of dirs) { try { fs.renameSync(path.join(backup, d), path.join(gameDir, d)); } catch { failed.push({ file: d, fix: 'restore' }); } }
    if (configs.length) {
      const file = path.join(gameDir, ITEM_HANDLERS);
      try { if (configs[0]) fs.copyFileSync(path.join(backup, ITEM_HANDLERS), file); else fs.rmSync(file, { force: true }); } catch { failed.push({ file: ITEM_HANDLERS.split(path.sep).join('/'), fix: configs[0] ? 'restore' : 'delete' }); }
    }
    const busy = ['EBUSY', 'EPERM', 'EACCES'].includes(e.code);
    const out = { ok: false, error: busy ? '文件被占用：请完全关闭游戏或服务器后重试' : e.message, rolledBack: !failed.length };
    // 没恢复的文件和备份目录一起交给用户手动处理：fix 为 restore 是把备份里的同名文件放回游戏目录，delete 是删掉游戏目录里多出的新文件
    if (failed.length) Object.assign(out, { rollbackFailed: failed, backup });
    return out;
  }
  const backedUp = moved.length || dirs.length || configs.some(Boolean);
  return { ok: true, id, action, name: plan.name, notes: plan.notes, backup: backedUp ? backup : '' };
}

/** 一次只跑一个安装任务（下载可能要几分钟），网页轮询进度。 */
export function createPluginJobs(opts = {}) {
  let job = null;
  return {
    status: () => job,
    start(gameDir, id, action, catalog = opts.catalog) {
      if (job && !job.done) return { ok: false, error: '另一项安装尚未完成' };
      const current = job = { id, action, gameDir, done: false, phase: 'start', startedAt: Date.now() };
      applyPlugin(gameDir, id, action, { ...opts, ...(catalog ? { catalog } : {}), progress: (p) => Object.assign(current, p) })
        .then((r) => Object.assign(current, { done: true, result: r }))
        .catch((e) => Object.assign(current, { done: true, result: { ok: false, error: e.message } }));
      return { ok: true };
    },
  };
}
