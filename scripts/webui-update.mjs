// 主程序更新和公告（docs/update_design.md 第四、六、七节）。
// - 总清单 index.json：按来源顺序读，每个最多等 5 秒，用第一个读到且格式正确的；读到就存进 runtime/update-index.json，
//   读不到时按上一次存下的显示（注明上次检查的时间）。固定的服务器地址排第一（长期不变），清单里记的其他来源排在后面，
//   以后换 GitHub 组织名之类，旧安装也能找到新地址；清单被写坏一次也不会让以后一直先去别处读。
// - 服务器来源：根地址 + file；GitHub 来源（.../releases/download/）：+ tag/ + 文件名，清单在固定的 index Release 里。
// - 更新：没有托管在跑、插件页没有在装卸时，下载安装包到 runtime/updates（只比大小，按多久没收到数据算超时，一个来源失败换下一个），
//   用 /SILENT /SUPPRESSMSGBOXES /NORESTART 运行（detached），WebUI 随即以退出码 0 退出；替换文件、重新打开 WebUI 由安装包负责。
// - 公告：纯文字，只给 appMin～appMax 之间的版本看，until 之后不再弹；点了「知道了」把 id 记进 runtime/notices-seen.json。
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { compareVersions, parseVersion, readAppVersion } from './version.mjs';
import { PROGRAM_DIR, isInstalled } from './paths.mjs';
import { normalizeDir, nodeProcesses } from './game-processes.mjs';

/** WebUI 认识的清单格式；清单的 schema 更高时不自动更新，只提示到网站下载。 */
export const SCHEMA = 1;
/** 发布的地方（release.mjs 写进清单、publish.mjs 上传都用这里的）：更新服务器在前，GitHub Releases 在后。 */
export const SERVER_SOURCE = 'https://mcbot.muxueuma.com/';
export const GITHUB_REPO = 'muxue-mcbot/mcbot';
export const DEFAULT_SOURCES = [SERVER_SOURCE, `https://github.com/${GITHUB_REPO}/releases/download/`];
const INDEX_FILE = 'update-index.json', SEEN_FILE = 'notices-seen.json';
const INDEX_TIMEOUT_MS = 5000;
/** 下载时多久没收到数据算超时（不按总时长算：安装包约 40 MB，慢的网络要下好几分钟）。 */
const IDLE_TIMEOUT_MS = 60 * 1000;
const INSTALLER_ARGS = ['/SILENT', '/SUPPRESSMSGBOXES', '/NORESTART'];

const SOURCE_RE = /^https:\/\/[^\s/?#]+\/(?:[^\s?#]*\/)?$/;
const GITHUB_RE = /^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\/$/;
const FILE_RE = /^[a-z0-9_-]+\/[A-Za-z0-9._+-]+$/;
const TAG_RE = /^[A-Za-z0-9._+-]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const isVersion = (v) => { try { parseVersion(v); return true; } catch { return false; } };
const isSize = (n) => Number.isSafeInteger(n) && n > 0;
const strings = (a) => (Array.isArray(a) ? a.filter((s) => typeof s === 'string') : []);
const today = (now = new Date()) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

export const isGithubSource = (source) => GITHUB_RE.test(source);
export const indexUrl = (source) => source + (isGithubSource(source) ? 'index/index.json' : 'index.json');
/** 清单里一个文件（app、核心、插件）在这个来源的下载地址。 */
export const fileUrl = (source, { file, tag }) => source + (isGithubSource(source) ? `${tag}/${path.posix.basename(file)}` : file);

/** 来源列表：清单里记的在前，默认的在后，去重；只要 https、以 / 结尾的地址。 */
export function mergeSources(...lists) {
  const out = [];
  for (const s of lists.flat()) if (typeof s === 'string' && SOURCE_RE.test(s) && !out.includes(s)) out.push(s);
  return out;
}

const validFile = (x) => x && typeof x.file === 'string' && FILE_RE.test(x.file) && isSize(x.size);

/** 检查清单格式；不认识的字段忽略。返回 { ok, index } 或 { ok:false, tooNew } 或 { ok:false, error }。 */
export function readIndex(raw) {
  if (!raw || typeof raw !== 'object' || !Number.isInteger(raw.schema)) return { ok: false, error: '更新清单格式错误' };
  if (raw.schema > SCHEMA) return { ok: false, tooNew: true, error: '更新清单的格式较新，无法自动更新' };
  const app = raw.app;
  if (!app || !isVersion(app.version) || !validFile(app) || !TAG_RE.test(String(app.tag)) || !/\.exe$/i.test(app.file)) return { ok: false, error: '更新清单格式错误' };
  const notices = (Array.isArray(raw.notices) ? raw.notices : []).filter((n) => n && typeof n.id === 'string' && n.id && typeof n.title === 'string' && typeof n.text === 'string'
    && (n.appMin === undefined || isVersion(n.appMin)) && (n.appMax === undefined || isVersion(n.appMax)) && (n.until === undefined || DATE_RE.test(n.until)))
    .map((n) => ({ id: n.id, date: typeof n.date === 'string' ? n.date : '', title: n.title, text: n.text, level: n.level === 'warn' ? 'warn' : 'info',
      ...(n.appMin ? { appMin: n.appMin } : {}), ...(n.appMax ? { appMax: n.appMax } : {}), ...(n.until ? { until: n.until } : {}) }));
  return { ok: true, index: {
    schema: raw.schema, updated: typeof raw.updated === 'string' ? raw.updated : '', sources: mergeSources(strings(raw.sources)),
    app: { version: app.version, date: typeof app.date === 'string' ? app.date : '', notes: strings(app.notes), file: app.file, tag: app.tag, size: app.size,
      ...(validFile(app.core) ? { core: { file: app.core.file, size: app.core.size } } : {}) },
    notices, plugins: raw.plugins && typeof raw.plugins === 'object' ? raw.plugins : {},
  } };
}

/** 上一次存下的清单（插件页也用它）：{ index, checkedAt, from }；没有或格式不对返回 null。 */
export function cachedIndex(runtime) {
  const c = readJson(path.join(runtime, INDEX_FILE)), got = readIndex(c?.index);
  return got.ok ? { index: got.index, checkedAt: c.checkedAt || 0, from: typeof c.from === 'string' ? c.from : '' } : null;
}
/** 下载用的来源顺序：默认的（服务器）、读到清单的那个、清单里记的。 */
export const downloadSources = (cache) => mergeSources(DEFAULT_SOURCES, cache?.from ? [cache.from] : [], cache?.index?.sources || []);

/** 按顺序读各来源的清单，用第一个读到且格式正确的。 */
export async function fetchIndex(sources, { fetchImpl = fetch, timeoutMs = INDEX_TIMEOUT_MS } = {}) {
  let tooNew = false;
  for (const source of sources) {
    try {
      const r = await fetchImpl(indexUrl(source), { redirect: 'follow', cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
      if (!r.ok) continue;
      const got = readIndex(await r.json());
      if (got.ok) return { ok: true, index: got.index, from: source };
      if (got.tooNew) tooNew = true;
    } catch { /* 换下一个来源 */ }
  }
  return tooNew ? { ok: false, tooNew: true, error: '更新清单的格式较新：请到网站下载新版安装包' } : { ok: false, error: '无法连接更新服务器' };
}

/** 这个版本能看到的公告：在 appMin～appMax 之间；expired 标出 until 已过的（历史里还列，但不再弹）。 */
export function noticesFor(index, current, now = new Date()) {
  const day = today(now);
  return (index?.notices || []).filter((n) => (!n.appMin || compareVersions(current, n.appMin) >= 0) && (!n.appMax || compareVersions(current, n.appMax) <= 0))
    .map((n) => ({ ...n, expired: !!n.until && day > n.until }));
}

const seenIds = (runtime) => new Set(strings(readJson(path.join(runtime, SEEN_FILE))?.ids));
/** 点了「知道了」的公告不再弹。 */
export function dismissNotice(runtime, id) {
  if (typeof id !== 'string' || !id || id.length > 200) return { ok: false, error: '公告 id 格式错误' };
  const ids = seenIds(runtime); ids.add(id);
  fs.mkdirSync(runtime, { recursive: true });
  fs.writeFileSync(path.join(runtime, SEEN_FILE), JSON.stringify({ ids: [...ids] }, null, 2));
  return { ok: true };
}

/** 下载一个文件到 dest：只比大小（size 为 0 表示清单没写大小，只限制不超过 maxBytes）；多久没收到数据算超时；先写 .part，对上了才改名。 */
export async function downloadFile(url, dest, size, { maxBytes = 256 * 1024 * 1024, fetchImpl = fetch, idleMs = IDLE_TIMEOUT_MS, progress = () => {} } = {}) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const part = `${dest}.${process.pid}.part`, ctl = new AbortController();
  let timer, out = null;
  const arm = () => { clearTimeout(timer); timer = setTimeout(() => ctl.abort(new Error('下载超时：长时间没有收到数据')), idleMs); };
  arm();
  try {
    const r = await fetchImpl(url, { redirect: 'follow', signal: ctl.signal });
    if (!r.ok || !r.body) throw new Error(`下载失败（HTTP ${r.status}）`);
    let got = 0;
    const count = async function* (src) {
      for await (const chunk of src) {
        arm(); got += chunk.length;
        if (got > (size || maxBytes)) throw new Error(size ? '文件大于清单记录的大小，已放弃使用' : '文件过大，已放弃使用');
        progress(got);
        yield chunk;
      }
    };
    // 超时时连写盘一起中断，并且不等读数据的那一步自己结束（卡住的连接可能一直不报错）
    out = fs.createWriteStream(part);
    const piping = pipeline(r.body, count, out, { signal: ctl.signal });
    piping.catch(() => {});
    await Promise.race([piping, new Promise((_, reject) => ctl.signal.addEventListener('abort', () => reject(ctl.signal.reason), { once: true }))]);
    if (size && got !== size) throw new Error(`文件大小不一致（清单 ${size}，实际 ${got}），已放弃使用`);
    fs.renameSync(part, dest);
  } catch (e) {
    // 等写入流关掉再删，不然 Windows 上半截文件会留下
    if (out && !out.closed) await new Promise((resolve) => out.once('close', resolve));
    try { fs.rmSync(part, { force: true }); } catch { /* 留着也无妨 */ }
    throw ctl.signal.aborted && ctl.signal.reason instanceof Error ? ctl.signal.reason : e;
  } finally { clearTimeout(timer); }
}

/** 有没有从这个程序目录启动的托管（启动脚本在等世界时还没有心跳，所以查 node 进程的命令行）。 */
export function hostingCommand(cmd, programDir = PROGRAM_DIR) {
  const text = String(cmd ?? '').replace(/\\/g, '/').toLowerCase(), dir = normalizeDir(programDir);
  return ['/scripts/start-server-play.mjs', '/scripts/companion.mjs', '/client-runtime/dist/main.js'].some((s) => text.includes(dir + s));
}

/**
 * 更新检查和执行。busy() 返回不能更新的原因（托管在跑、插件页在装卸），空字符串表示可以。
 * 测试时换掉 fetchImpl、listProcesses、launch（运行安装包）、exit（WebUI 退出）。
 */
export function createUpdater({ runtime, programDir = PROGRAM_DIR, fetchImpl = fetch, busy = async () => '', listProcesses = nodeProcesses,
  installed = () => isInstalled(programDir), launch = launchInstaller, exit = () => setTimeout(() => process.exit(0), 500), now = () => new Date() }) {
  const current = readAppVersion(programDir);
  let checking = null, lastError = '', tooNew = false, job = null, starting = false;

  async function check() {
    if (checking) return checking;
    checking = (async () => {
      const got = await fetchIndex(mergeSources(DEFAULT_SOURCES, cachedIndex(runtime)?.index?.sources || []), { fetchImpl });
      tooNew = !!got.tooNew; lastError = got.ok ? '' : got.error;
      if (got.ok) {
        fs.mkdirSync(runtime, { recursive: true });
        fs.writeFileSync(path.join(runtime, INDEX_FILE), JSON.stringify({ checkedAt: Date.now(), from: got.from, index: got.index }, null, 2));
      }
    })().finally(() => { checking = null; });
    return checking;
  }

  /** 页面用的状态：当前版本、最新版本、要弹的公告和公告历史。 */
  function view() {
    const c = cachedIndex(runtime), index = c?.index || null;
    const app = index?.app;
    const available = !!app && compareVersions(app.version, current) > 0;
    const notices = index ? noticesFor(index, current, now()) : [];
    const seen = seenIds(runtime);
    return {
      ok: true, current, installed: installed(), checking: !!checking, checkedAt: c?.checkedAt || 0, error: lastError, tooNew,
      latest: app ? { version: app.version, date: app.date, notes: app.notes, size: app.size, url: fileUrl(c.from || DEFAULT_SOURCES[0], app) } : null,
      available, popup: notices.filter((n) => !n.expired && !seen.has(n.id)), notices,
      job: job && { phase: job.phase, bytes: job.bytes || 0, total: job.total || 0, error: job.error || '' },
    };
  }

  /** 不能更新的原因；可以更新返回空字符串。 */
  async function blocker() {
    const reason = await busy();
    if (reason) return reason;
    let procs;
    try { procs = await listProcesses(); } catch { return '无法确认托管是否已停止：无法查询进程列表'; }
    return procs.some((p) => hostingCommand(p.commandLine, programDir)) ? '有托管正在运行或等待世界：请先在「监控」或「配置」中停止托管' : '';
  }

  async function run(app, sources) {
    const dir = path.join(runtime, 'updates'), dest = path.join(dir, path.posix.basename(app.file));
    // 只留这次要装的安装包：以前更新留下的和中途关掉 WebUI 留下的半截文件都删掉
    try { for (const n of fs.readdirSync(dir)) if (n !== path.basename(dest)) fs.rmSync(path.join(dir, n), { force: true, recursive: true }); } catch { /* 还没有这个目录 */ }
    let ok = false, error = '';
    try { ok = fs.statSync(dest).size === app.size; } catch { /* 还没下过 */ }
    for (const source of ok ? [] : sources) {
      try {
        Object.assign(job, { phase: 'download', bytes: 0, total: app.size });
        await downloadFile(fileUrl(source, app), dest, app.size, { fetchImpl, progress: (b) => { job.bytes = b; } });
        ok = true; break;
      } catch (e) { error = e.message.startsWith('fetch failed') ? '无法连接下载服务器' : e.message; }
    }
    if (!ok) return Object.assign(job, { phase: 'error', error: `安装包下载失败：${error || '没有可用的下载地址'}` });
    // 下载要等一阵，运行安装包前再查一次
    const again = await blocker();
    if (again) return Object.assign(job, { phase: 'error', error: again });
    job.phase = 'launch';
    try { await launch(dest, INSTALLER_ARGS); } catch (e) { return Object.assign(job, { phase: 'error', error: `无法运行安装包：${e.message}` }); }
    job.phase = 'exiting';
    exit();
  }

  /** 开始更新：先确认能更新，再在后台下载、运行安装包；网页轮询 view().job。 */
  async function start() {
    // 检查是异步的：两个标签页同时点「更新」时只放行一个
    if (starting || (job && job.phase !== 'error')) return { ok: false, error: '更新已在进行中' };
    if (!installed()) return { ok: false, error: '开发环境中无法自动更新：请使用安装包安装的 mcbot' };
    const c = cachedIndex(runtime);
    if (!c) return { ok: false, error: '尚未读取到更新清单：请先检查更新' };
    if (compareVersions(c.index.app.version, current) <= 0) return { ok: false, error: '已是最新版本' };
    starting = true;
    try {
      const reason = await blocker();
      if (reason) return { ok: false, error: reason };
      job = { phase: 'download', bytes: 0, total: c.index.app.size };
    } finally { starting = false; }
    run(c.index.app, downloadSources(c)).catch((e) => Object.assign(job, { phase: 'error', error: e.message }));
    return { ok: true };
  }

  return { check, view, start, current };
}

/** 运行安装包（detached，不等它结束）；起不来时 reject。 */
export function launchInstaller(file, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}
