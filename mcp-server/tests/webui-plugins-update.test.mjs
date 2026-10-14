// 插件页按版本更新（docs/update_design.md 第八节）：安装版没有本地构建，我们的 jar 全部从更新服务器或 GitHub 下载。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyPlugin, compareInstalled, inspectPlugins, loadCatalog, planPlugin } from '../../scripts/webui-plugins.mjs';
import { fileUrl } from '../../scripts/webui-update.mjs';
import { modJar } from './jar-fixture.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-plugup-'));
const put = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); };
const SERVER = 'https://mcbot.muxueuma.com/', GITHUB = 'https://github.com/org/repo/releases/download/';

function fixture({ index = true } = {}) {
  const root = tmp(), runtime = path.join(root, 'runtime'), game = path.join(root, 'game');
  const kc16 = modJar('kaleidoscope_cookery', '1.6.0'), kc17 = modJar('kaleidoscope_cookery', '1.7.0'), furnace = modJar('ironfurnaces', '4.3.2');
  const core2 = modJar('mcbot_server_control', '0.0.2'), adapter3 = modJar('mcbot_kaleidoscope_cookery', '0.0.3');
  const kcReq = (v, jar) => [{ modId: 'kaleidoscope_cookery', version: v, side: 'both', license: 'CC', modrinth: { file: `kc-${v}.jar`, size: jar.length, url: `https://cdn.modrinth.com/data/kc/kc-${v}.jar` } }];
  put(path.join(root, 'compat.json'), JSON.stringify({
    schema: 1, platform: { minecraft: '1.21.1', loader: 'neoforge' },
    core: { id: 'mcbot_server_control', name: '核心', project: 'mods/mcbot-server-control', jar: 'mcbot-server-control-0.0.2.jar', what: '服务端身体' },
    adapters: [
      { id: 'kaleidoscope_cookery', name: '森罗厨房', kind: 'addon', project: 'mods/mcbot-kaleidoscope-cookery', jar: 'mcbot-kaleidoscope-cookery-0.0.1.jar', coreMin: '0.0.1', requires: kcReq('1.6.0', kc16) },
      { id: 'iron_furnaces', name: '铁炉', kind: 'addon', project: 'mods/mcbot-iron-furnaces', jar: 'mcbot-iron-furnaces-0.0.1.jar', coreMin: '0.0.1',
        requires: [{ modId: 'ironfurnaces', version: '4.3.2', side: 'both', modrinth: { file: 'ironfurnaces-4.3.2.jar', size: furnace.length, url: 'https://cdn.modrinth.com/data/if/ironfurnaces-4.3.2.jar' } }] },
    ],
  }));
  put(path.join(root, 'client-runtime', 'package.json'), JSON.stringify({ version: '0.0.2' }));
  if (index) put(path.join(runtime, 'update-index.json'), JSON.stringify({ checkedAt: 123, from: SERVER, index: {
    schema: 1, sources: [SERVER, GITHUB],
    app: { version: '0.0.2', file: 'app/mcbot-setup-0.0.2.exe', tag: 'app-v0.0.2', size: 9, core: { file: 'core/mcbot-server-control-0.0.2.jar', size: core2.length } },
    plugins: {
      kaleidoscope_cookery: { version: '0.0.3', file: 'plugins/mcbot-kaleidoscope-cookery-0.0.3.jar', tag: 'kaleidoscope_cookery-v0.0.3', size: adapter3.length, coreMin: '0.0.2',
        notes: ['炒锅更快'], name: '森罗厨房', kind: 'addon', requires: kcReq('1.7.0', kc17) },
      iron_furnaces: { version: '0.0.2', file: 'plugins/mcbot-iron-furnaces-0.0.2.jar', tag: 'iron_furnaces-v0.0.2', size: 10, coreMin: '0.0.9' },
    },
  } }));
  // 游戏里装着旧的核心、旧的森罗厨房适配和旧版森罗厨房本体
  put(path.join(game, 'mods', 'mcbot-server-control-0.0.1.jar'), modJar('mcbot_server_control', '0.0.1'));
  put(path.join(game, 'mods', 'mcbot-kaleidoscope-cookery-0.0.1.jar'), modJar('mcbot_kaleidoscope_cookery', '0.0.1'));
  put(path.join(game, 'mods', 'kc-1.6.0.jar'), kc16);
  put(path.join(game, 'config', 'mcbot-server-control', 'server.json'), '{"username":"Bot"}');
  // 服务器上没有森罗厨房适配 0.0.3（只传到了 GitHub），用来测换来源
  const files = {
    [fileUrl(SERVER, { file: 'core/mcbot-server-control-0.0.2.jar', tag: 'app-v0.0.2' })]: core2,
    [fileUrl(GITHUB, { file: 'plugins/mcbot-kaleidoscope-cookery-0.0.3.jar', tag: 'kaleidoscope_cookery-v0.0.3' })]: adapter3,
    'https://cdn.modrinth.com/data/kc/kc-1.7.0.jar': kc17,
  };
  const fetched = [];
  const fetchImpl = async (url) => { fetched.push(url); return files[url] ? new Response(files[url]) : new Response('no', { status: 404 }); };
  return { root, runtime, game, files, fetched, fetchImpl, opts: { runtime, fetchImpl, online: async () => false, listProcesses: async () => [] } };
}
const cleanup = (f) => fs.rmSync(f.root, { recursive: true, force: true });
const catalogOf = (f) => loadCatalog(f.root, { runtime: f.runtime });

test('版本比较：读不出版本当旧版；方案之前的 0.1.0 在要装的版本低于 0.1.0 时当旧版', () => {
  assert.equal(compareInstalled('0.0.1', '0.0.2'), -1);
  assert.equal(compareInstalled('0.0.10', '0.0.9'), 1);
  assert.equal(compareInstalled('', '0.0.2'), -1);
  assert.equal(compareInstalled('1.0-SNAPSHOT', '0.0.2'), -1);
  assert.equal(compareInstalled('0.1.0', '0.0.9'), -1);
  assert.equal(compareInstalled('0.1.0', '0.1.0'), 0);
});

test('插件目录：核心跟主程序同版本；适配插件按清单换到满足 coreMin 的新版本，不满足的记下要先更新主程序', () => {
  const f = fixture();
  try {
    const c = catalogOf(f);
    assert.equal(c.appVersion, '0.0.2'); assert.equal(c.manifestAt, 123);
    assert.deepEqual(c.core.remote, { file: 'core/mcbot-server-control-0.0.2.jar', tag: 'app-v0.0.2', size: f.files[fileUrl(SERVER, { file: 'core/mcbot-server-control-0.0.2.jar' })].length });
    const kc = c.plugins.find((p) => p.id === 'kaleidoscope_cookery'), iron = c.plugins.find((p) => p.id === 'iron_furnaces');
    assert.deepEqual([kc.version, kc.jar, kc.mods[0].version, kc.notes], ['0.0.3', 'mcbot-kaleidoscope-cookery-0.0.3.jar', '1.7.0', ['炒锅更快']]);
    assert.deepEqual([iron.version, iron.jar, iron.needApp], ['0.0.1', 'mcbot-iron-furnaces-0.0.1.jar', { version: '0.0.2', coreMin: '0.0.9' }]);
    assert.deepEqual(iron.remote, { file: 'plugins/mcbot-iron-furnaces-0.0.1.jar', tag: 'iron_furnaces-v0.0.1', size: 0 }, '没有清单里的版本时按规则拼地址');
    const s = inspectPlugins(f.game, c);
    assert.deepEqual([s.core.overall, s.core.parts[0].state, s.core.parts[0].version, s.core.parts[0].want], ['update', 'old', '0.0.1', '0.0.2']);
    assert.equal(s.plugins.find((p) => p.id === 'kaleidoscope_cookery').overall, 'fix', '适配旧、本体也要换');
    assert.equal(s.plugins.find((p) => p.id === 'iron_furnaces').overall, 'none');
  } finally { cleanup(f); }
});

test('全部更新：核心和已安装的插件一起出计划，没装的不装；我们的 jar 按来源顺序下载，失败换 GitHub', async () => {
  const f = fixture();
  try {
    const plan = planPlugin(f.game, '', 'update-all', { catalog: catalogOf(f), runtime: f.runtime });
    assert.equal(plan.ok, true); assert.equal(plan.name, '全部更新');
    assert.deepEqual(plan.steps.map((s) => [s.op, s.file]), [
      ['remove', 'mcbot-server-control-0.0.1.jar'], ['download', 'mcbot-server-control-0.0.2.jar'], ['add', 'mcbot-server-control-0.0.2.jar'],
      ['remove', 'mcbot-kaleidoscope-cookery-0.0.1.jar'], ['download', 'mcbot-kaleidoscope-cookery-0.0.3.jar'], ['add', 'mcbot-kaleidoscope-cookery-0.0.3.jar'],
      ['remove', 'kc-1.6.0.jar'], ['download', 'kc-1.7.0.jar'], ['add', 'kc-1.7.0.jar'],
    ]);
    assert.deepEqual(plan.steps[1].urls, [SERVER + 'core/mcbot-server-control-0.0.2.jar', GITHUB + 'app-v0.0.2/mcbot-server-control-0.0.2.jar']);
    const r = await applyPlugin(f.game, '', 'update-all', { ...f.opts, catalog: catalogOf(f) });
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(fs.readdirSync(path.join(f.game, 'mods')).sort(), ['kc-1.7.0.jar', 'mcbot-kaleidoscope-cookery-0.0.3.jar', 'mcbot-server-control-0.0.2.jar']);
    assert.deepEqual(fs.readdirSync(path.join(r.backup, 'mods')).sort(), ['kc-1.6.0.jar', 'mcbot-kaleidoscope-cookery-0.0.1.jar', 'mcbot-server-control-0.0.1.jar']);
    assert.ok(f.fetched.indexOf(SERVER + 'plugins/mcbot-kaleidoscope-cookery-0.0.3.jar') < f.fetched.indexOf(GITHUB + 'kaleidoscope_cookery-v0.0.3/mcbot-kaleidoscope-cookery-0.0.3.jar'), '先服务器后 GitHub');
    const after = inspectPlugins(f.game, catalogOf(f));
    assert.equal(after.core.overall, 'ok'); assert.equal(after.plugins.find((p) => p.id === 'kaleidoscope_cookery').overall, 'ok');
    assert.equal(planPlugin(f.game, '', 'update-all', { catalog: catalogOf(f), runtime: f.runtime }).nothing, true);
  } finally { cleanup(f); }
});

test('核心比主程序新时不在插件页装，提示先更新主程序；方案之前的 0.1.0 当旧版', () => {
  const f = fixture();
  try {
    fs.rmSync(path.join(f.game, 'mods', 'mcbot-server-control-0.0.1.jar'));
    put(path.join(f.game, 'mods', 'mcbot-server-control-0.0.5.jar'), modJar('mcbot_server_control', '0.0.5'));
    const s = inspectPlugins(f.game, catalogOf(f));
    assert.deepEqual([s.core.coreNewer, s.core.canInstall, s.core.overall], [true, false, 'fix']);
    assert.match(planPlugin(f.game, 'mcbot_server_control', 'install', { catalog: catalogOf(f), runtime: f.runtime }).error, /比主程序（0\.0\.2）新：请先更新主程序/);
    assert.match(planPlugin(f.game, '', 'update-all', { catalog: catalogOf(f), runtime: f.runtime }).error, /请先更新主程序/);
    fs.rmSync(path.join(f.game, 'mods', 'mcbot-server-control-0.0.5.jar'));
    put(path.join(f.game, 'mods', 'mcbot-server-control-0.1.0.jar'), modJar('mcbot_server_control', '0.1.0'));
    assert.equal(inspectPlugins(f.game, catalogOf(f)).core.parts[0].state, 'old');
  } finally { cleanup(f); }
});

test('没有清单时按规则拼地址；下载的 jar 里 mod id 或版本不对就不用', async () => {
  const f = fixture({ index: false });
  try {
    fs.rmSync(path.join(f.game, 'mods'), { recursive: true });
    const c = catalogOf(f);
    assert.deepEqual(c.core.remote, { file: 'core/mcbot-server-control-0.0.2.jar', tag: 'app-v0.0.2', size: 0 });
    const plan = planPlugin(f.game, 'mcbot_server_control', 'install', { catalog: c, runtime: f.runtime });
    assert.deepEqual(plan.steps[0].urls, [SERVER + 'core/mcbot-server-control-0.0.2.jar'], '只有默认来源');
    f.files[SERVER + 'core/mcbot-server-control-0.0.2.jar'] = modJar('mcbot_server_control', '0.0.1');
    const r = await applyPlugin(f.game, 'mcbot_server_control', 'install', { ...f.opts, catalog: c });
    assert.equal(r.ok, false); assert.match(r.error, /内容与清单不符/);
    assert.deepEqual(fs.readdirSync(path.join(f.runtime, 'mod-downloads')), [], '不对的文件已删掉');
  } finally { cleanup(f); }
});

test('从此游戏移除 mcbot：核心、适配 jar 和 config/mcbot-server-control 都移到备份，被适配的模组本体保留', async () => {
  const f = fixture();
  try {
    const plan = planPlugin(f.game, '', 'remove-all', { catalog: catalogOf(f), runtime: f.runtime });
    assert.deepEqual(plan.steps.map((s) => [s.op, s.file]), [['remove', 'mcbot-server-control-0.0.1.jar'], ['remove', 'mcbot-kaleidoscope-cookery-0.0.1.jar'], ['remove-dir', 'config/mcbot-server-control']]);
    assert.ok(plan.notes.some((n) => /kaleidoscope_cookery 本体将保留/.test(n)));
    const r = await applyPlugin(f.game, '', 'remove-all', { ...f.opts, catalog: catalogOf(f) });
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(fs.readdirSync(path.join(f.game, 'mods')), ['kc-1.6.0.jar']);
    assert.equal(fs.existsSync(path.join(f.game, 'config', 'mcbot-server-control')), false);
    assert.equal(fs.readFileSync(path.join(r.backup, 'config', 'mcbot-server-control', 'server.json'), 'utf8'), '{"username":"Bot"}');
  } finally { cleanup(f); }
});
