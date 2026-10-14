import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createUpdater, dismissNotice, downloadFile, fetchIndex, fileUrl, hostingCommand, indexUrl, mergeSources, noticesFor, readIndex } from '../../scripts/webui-update.mjs';
import { createWebServer } from '../../scripts/webui.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-update-'));
const SERVER = 'https://mcbot.muxueuma.com/', GITHUB = 'https://github.com/org/repo/releases/download/';
const index = (extra = {}) => ({
  schema: 1, updated: '2026-10-20', sources: [SERVER, GITHUB],
  app: { version: '0.0.2', date: '2026-10-20', notes: ['修了一处问题'], file: 'app/mcbot-setup-0.0.2.exe', tag: 'app-v0.0.2', size: 5,
    core: { file: 'core/mcbot-server-control-0.0.2.jar', size: 3 } },
  notices: [
    { id: 'a', date: '2026-10-15', title: '公告 A', text: '第一行\n第二行', level: 'info' },
    { id: 'old', title: '只给旧版', text: 'x', appMax: '0.0.0' },
    { id: 'gone', title: '过期', text: 'x', until: '2026-10-01' },
    { id: 'warn', title: '重要', text: 'y', level: 'warn', appMin: '0.0.1', unknown: 1 },
  ],
  plugins: {}, ...extra,
});
// 假的网络：url → { status, body }；body 是对象时当 JSON
function fakeFetch(routes, calls = []) {
  return async (url) => {
    calls.push(url);
    const r = routes[url];
    if (r instanceof Error) throw r;
    if (!r) return new Response('no', { status: 404 });
    return new Response(typeof r.body === 'object' && !(r.body instanceof Uint8Array) && !(r.body instanceof ReadableStream) ? JSON.stringify(r.body) : r.body, { status: r.status || 200 });
  };
}
const programDir = (version = '0.0.1') => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'client-runtime'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'client-runtime', 'package.json'), JSON.stringify({ version }));
  return dir;
};

test('清单地址：服务器是根地址加 file，GitHub 是 Release 下载地址加 tag 和文件名；来源只要 https', () => {
  assert.equal(indexUrl(SERVER), 'https://mcbot.muxueuma.com/index.json');
  assert.equal(indexUrl(GITHUB), 'https://github.com/org/repo/releases/download/index/index.json');
  const app = index().app;
  assert.equal(fileUrl(SERVER, app), 'https://mcbot.muxueuma.com/app/mcbot-setup-0.0.2.exe');
  assert.equal(fileUrl(GITHUB, app), 'https://github.com/org/repo/releases/download/app-v0.0.2/mcbot-setup-0.0.2.exe');
  assert.deepEqual(mergeSources([GITHUB, 'http://evil/', 'https://x.example/no-slash', 3], [SERVER, GITHUB]), [GITHUB, SERVER]);
});

test('清单格式：不认识的字段忽略，schema 更高不自动更新，文件路径不能跳出目录', () => {
  const ok = readIndex(index());
  assert.equal(ok.ok, true);
  assert.equal(ok.index.app.core.file, 'core/mcbot-server-control-0.0.2.jar');
  assert.equal(ok.index.notices.find((n) => n.id === 'warn').unknown, undefined);
  assert.equal(readIndex(index({ schema: 2 })).tooNew, true);
  for (const file of ['../x.exe', 'app/../../x.exe', '/app/x.exe', 'app\\x.exe', 'app/x.zip']) assert.equal(readIndex(index({ app: { ...index().app, file } })).ok, false, file);
  assert.equal(readIndex(index({ app: { ...index().app, version: '0.0.2-beta' } })).ok, false);
  assert.equal(readIndex(index({ app: { ...index().app, size: 0 } })).ok, false);
  assert.equal(readIndex({ schema: '1' }).ok, false);
  assert.equal(readIndex(index({ notices: [{ id: 'x', title: 't', text: 'x', until: '明天' }, { id: 'y', title: 't', text: 'y' }] })).index.notices.length, 1, '格式不对的公告跳过');
});

test('读清单：按顺序，一个来源连不上或格式不对就换下一个；都不行说清楚原因', async () => {
  const calls = [];
  const r = await fetchIndex([SERVER, GITHUB], { fetchImpl: fakeFetch({ [indexUrl(SERVER)]: new TypeError('fetch failed'), [indexUrl(GITHUB)]: { body: index() } }, calls) });
  assert.equal(r.ok, true); assert.equal(r.from, GITHUB); assert.deepEqual(calls, [indexUrl(SERVER), indexUrl(GITHUB)]);
  assert.equal((await fetchIndex([SERVER], { fetchImpl: fakeFetch({ [indexUrl(SERVER)]: { body: { schema: 1 } } }) })).error, '无法连接更新服务器');
  assert.equal((await fetchIndex([SERVER], { fetchImpl: fakeFetch({ [indexUrl(SERVER)]: { body: index({ schema: 9 }) } }) })).tooNew, true);
});

test('公告：按版本范围给，过了 until 的只在历史里、标成已过期', () => {
  const list = noticesFor(readIndex(index()).index, '0.0.1', new Date(2026, 9, 14));
  assert.deepEqual(list.map((n) => [n.id, n.expired]), [['a', false], ['gone', true], ['warn', false]]);
  assert.deepEqual(noticesFor(readIndex(index()).index, '0.0.0', new Date(2026, 9, 14)).map((n) => n.id), ['a', 'old', 'gone']);
});

test('下载：只比大小，大小不对删掉半截文件；长时间收不到数据算超时', async () => {
  const dir = tmp();
  try {
    const dest = path.join(dir, 'a.exe');
    await assert.rejects(downloadFile('u', dest, 4, { fetchImpl: fakeFetch({ u: { body: 'abc' } }) }), /大小不一致/);
    await assert.rejects(downloadFile('u', dest, 2, { fetchImpl: fakeFetch({ u: { body: 'abc' } }) }), /大于清单/);
    assert.deepEqual(fs.readdirSync(dir), [], '没有留下半截文件');
    const stall = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('ab')); } });
    await assert.rejects(downloadFile('u', dest, 5, { idleMs: 50, fetchImpl: async () => new Response(stall) }), /超时/);
    assert.deepEqual(fs.readdirSync(dir), [], '超时也删掉半截文件');
    await downloadFile('u', dest, 3, { fetchImpl: fakeFetch({ u: { body: 'abc' } }) });
    assert.equal(fs.readFileSync(dest, 'utf8'), 'abc');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('托管进程：只认从这个程序目录启动的启动脚本、驱动器和运行端', () => {
  const dir = 'C:\\Users\\a\\AppData\\Local\\Programs\\mcbot';
  assert.equal(hostingCommand(`"${dir}\\node\\node.exe" "${dir}\\scripts\\start-server-play.mjs" --wait`, dir), true);
  assert.equal(hostingCommand(`"${dir}\\node\\node.exe" ${dir}\\client-runtime\\dist\\main.js --body server`, dir), true);
  assert.equal(hostingCommand(`"${dir}\\node\\node.exe" "${dir}\\scripts\\webui.mjs" --open`, dir), false, 'WebUI 自己不算');
  assert.equal(hostingCommand('node G:\\mc\\repo\\scripts\\companion.mjs', dir), false, '别处的不算');
});

test('主程序更新：检查后存下清单，有新版本只提示；托管在跑时不更新；下载失败换来源，下载完运行安装包后退出', async () => {
  const runtime = tmp(), prog = programDir('0.0.1');
  const installer = new Uint8Array([1, 2, 3, 4, 5]);
  const calls = [], launched = [], exits = [];
  let procs = [{ pid: 1, commandLine: `node ${prog}\\scripts\\start-server-play.mjs --wait` }];
  const routes = { [indexUrl(SERVER)]: { body: index() }, [fileUrl(SERVER, index().app)]: { status: 503, body: 'x' }, [fileUrl(GITHUB, index().app)]: { body: installer } };
  const up = createUpdater({ runtime, programDir: prog, fetchImpl: fakeFetch(routes, calls), listProcesses: async () => procs,
    installed: () => true, launch: async (file, args) => { launched.push([file, args]); }, exit: () => exits.push(1), now: () => new Date(2026, 9, 14) });
  try {
    assert.equal(up.view().latest, null, '还没检查');
    await up.check();
    let v = up.view();
    assert.equal(v.current, '0.0.1'); assert.equal(v.available, true); assert.equal(v.latest.version, '0.0.2');
    assert.equal(v.latest.url, fileUrl(SERVER, index().app), '浏览器下载用读到清单的来源');
    assert.deepEqual(v.popup.map((n) => n.id), ['a', 'warn']);
    assert.deepEqual(dismissNotice(runtime, 'a'), { ok: true });
    assert.deepEqual(up.view().popup.map((n) => n.id), ['warn'], '点过「知道了」不再弹');
    assert.match((await up.start()).error, /托管/);
    procs = [];
    const updates = path.join(runtime, 'updates');
    fs.mkdirSync(updates, { recursive: true });
    fs.writeFileSync(path.join(updates, 'mcbot-setup-0.0.1.exe'), 'old'); fs.writeFileSync(path.join(updates, 'x.exe.99.part'), 'half');
    const [first, second] = await Promise.all([up.start(), up.start()]);
    assert.deepEqual(first, { ok: true }); assert.equal(second.error, '更新已在进行中', '同时点两次只放行一个');
    assert.equal((await up.start()).error, '更新已在进行中');
    for (let i = 0; i < 100 && !exits.length; i++) await new Promise((r) => setTimeout(r, 10));
    const dest = path.join(runtime, 'updates', 'mcbot-setup-0.0.2.exe');
    assert.deepEqual(launched, [[dest, ['/SILENT', '/SUPPRESSMSGBOXES', '/NORESTART']]]);
    assert.deepEqual(fs.readFileSync(dest), Buffer.from(installer));
    assert.deepEqual(fs.readdirSync(updates), ['mcbot-setup-0.0.2.exe'], '旧安装包和半截文件已删');
    assert.equal(exits.length, 1); assert.equal(up.view().job.phase, 'exiting');
    assert.ok(calls.includes(fileUrl(GITHUB, index().app)), '服务器下载失败后换 GitHub');
  } finally { fs.rmSync(runtime, { recursive: true, force: true }); fs.rmSync(prog, { recursive: true, force: true }); }
});

test('主程序更新：开发环境、已是最新、没有清单时不更新；读不到时保留上次的结果并说明', async () => {
  const runtime = tmp(), prog = programDir('0.0.2');
  let online = true;
  const fetchImpl = async (url) => { if (!online) throw new TypeError('fetch failed'); return fakeFetch({ [indexUrl(SERVER)]: { body: index() } })(url); };
  try {
    const dev = createUpdater({ runtime, programDir: prog, fetchImpl, listProcesses: async () => [], installed: () => false });
    assert.match((await dev.start()).error, /开发环境/);
    const up = createUpdater({ runtime, programDir: prog, fetchImpl, listProcesses: async () => [], installed: () => true });
    assert.match((await up.start()).error, /尚未读取到更新清单/);
    await up.check();
    assert.equal(up.view().available, false);
    assert.equal((await up.start()).error, '已是最新版本');
    online = false;
    await up.check();
    const v = up.view();
    assert.equal(v.error, '无法连接更新服务器'); assert.equal(v.latest.version, '0.0.2'); assert.ok(v.checkedAt > 0);
  } finally { fs.rmSync(runtime, { recursive: true, force: true }); fs.rmSync(prog, { recursive: true, force: true }); }
});

test('更新接口：要令牌；检查、公告的「知道了」走 POST JSON', async () => {
  const runtime = tmp(), prog = programDir('0.0.1');
  const updater = createUpdater({ runtime, programDir: prog, fetchImpl: fakeFetch({ [indexUrl(SERVER)]: { body: index() } }), listProcesses: async () => [], installed: () => false });
  const web = createWebServer({ runtime, token: 'ab12', updater });
  try {
    const port = await web.listen(0), base = `http://127.0.0.1:${port}`;
    assert.equal((await fetch(`${base}/api/update`)).status, 403);
    const cookie = (await fetch(`${base}/?t=ab12`, { redirect: 'manual' })).headers.get('set-cookie').split(';')[0];
    const json = { cookie, 'content-type': 'application/json' };
    assert.equal((await (await fetch(`${base}/api/update`, { headers: { cookie } })).json()).available, false);
    const v = await (await fetch(`${base}/api/update/check`, { method: 'POST', headers: json, body: '{}' })).json();
    assert.equal(v.available, true);
    assert.deepEqual(await (await fetch(`${base}/api/notices/dismiss`, { method: 'POST', headers: json, body: JSON.stringify({ id: 'warn' }) })).json(), { ok: true });
    assert.deepEqual((await (await fetch(`${base}/api/update`, { headers: { cookie } })).json()).popup.map((n) => n.id), ['a']);
    const start = await fetch(`${base}/api/update/start`, { method: 'POST', headers: json, body: '{}' });
    assert.equal(start.status, 409); assert.match((await start.json()).error, /开发环境/);
  } finally { await web.close(); fs.rmSync(runtime, { recursive: true, force: true }); fs.rmSync(prog, { recursive: true, force: true }); }
});
