import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadCompat } from '../../scripts/check-compat.mjs';
import { planRelease, writeRelease, parseReleaseArgs, checkNotice, SERVER } from '../../scripts/release.mjs';

const compat = loadCompat();
const addons = compat.adapters.filter((a) => a.kind === 'addon');
const built = (appVersion, pluginVersions = {}, sizes = {}) => ({
  app: { version: appVersion, installer: `/b/mcbot-setup-${appVersion}.exe`, size: sizes.app ?? 1000, core: `/b/mcbot-server-control-${appVersion}.jar`, coreSize: sizes.core ?? 100 },
  plugins: Object.fromEntries(addons.map((a) => [a.id, { version: pluginVersions[a.id] ?? '0.0.1', file: `/b/${a.jar}`, size: sizes[a.id] ?? 10 }])),
});
const allNotes = { app: ['首个版本'], plugins: Object.fromEntries(addons.map((a) => [a.id, ['首次发布']])) };
const base = { compat, date: '2026-10-20', org: 'org', repo: 'repo' };

test('a first release lists every part in the design format, with GitHub tags and plugin fields taken from compat.json', () => {
  const { index, files, warnings } = planRelease({ ...base, ...built('0.0.1'), prev: null, notes: allNotes });
  assert.deepEqual(warnings, []);
  assert.deepEqual(Object.keys(index), ['schema', 'updated', 'sources', 'app', 'notices', 'plugins']);
  assert.deepEqual(index.sources, [SERVER, 'https://github.com/org/repo/releases/download/']);
  assert.deepEqual(index.app, { version: '0.0.1', date: '2026-10-20', notes: ['首个版本'], file: 'app/mcbot-setup-0.0.1.exe', tag: 'app-v0.0.1', size: 1000,
    core: { file: 'core/mcbot-server-control-0.0.1.jar', size: 100 } });
  const kc = index.plugins.kaleidoscope_cookery, src = addons.find((a) => a.id === 'kaleidoscope_cookery');
  assert.equal(kc.tag, 'kaleidoscope_cookery-v0.0.1');
  assert.equal(kc.file, `plugins/${src.jar}`);
  assert.equal(kc.coreMin, src.coreMin);
  assert.deepEqual(kc.requires, src.requires);
  for (const k of ['project', 'jar', 'kind', 'id']) assert.ok(!(k in kc), `${k} 不进清单`);
  assert.deepEqual(Object.keys(index.plugins), addons.map((a) => a.id), '配置类适配没有 jar，不进 plugins');
  assert.equal(files.length, 2 + addons.length);
  assert.throws(() => planRelease({ ...base, ...built('0.0.1'), prev: null, notes: { app: ['x'] } }), /kaleidoscope_cookery 是新版本，--notes 里要写更新说明/);
});

test('unchanged parts are carried over; a newer part needs notes; an older version or a changed file under the same version is caught', () => {
  const prev = planRelease({ ...base, ...built('0.0.1'), prev: null, notes: allNotes }).index;
  prev.notices = [{ id: 'old', date: '2026-10-01', title: 't', text: 'x', level: 'info' }];

  const same = planRelease({ ...base, date: '2026-10-25', ...built('0.0.1'), prev, notes: {} });
  assert.deepEqual(same.files, []);
  assert.deepEqual(same.index.app, prev.app);
  assert.deepEqual(same.index.plugins, prev.plugins);
  assert.equal(same.index.updated, '2026-10-25');

  const bump = planRelease({ ...base, date: '2026-10-25', ...built('0.0.2', { iron_furnaces: '0.0.2' }), prev,
    notes: { app: ['修了'], plugins: { iron_furnaces: ['修了铁炉'] }, notices: [{ id: 'new', date: '2026-10-25', title: '公告', text: '内容', level: 'warn' }] } });
  assert.equal(bump.index.app.tag, 'app-v0.0.2');
  assert.equal(bump.index.plugins.iron_furnaces.date, '2026-10-25');
  assert.deepEqual(bump.index.plugins.kaleidoscope_cookery, prev.plugins.kaleidoscope_cookery);
  assert.deepEqual(bump.files.map((f) => f.to), ['app/mcbot-setup-0.0.2.exe', 'core/mcbot-server-control-0.0.2.jar', `plugins/${addons.find((a) => a.id === 'iron_furnaces').jar}`]);
  assert.deepEqual(bump.index.notices.map((n) => n.id), ['old', 'new']);

  assert.throws(() => planRelease({ ...base, ...built('0.0.2'), prev, notes: {} }), /app 是新版本/);
  assert.throws(() => planRelease({ ...base, ...built('0.0.1', { iron_furnaces: '0.0.0' }), prev, notes: allNotes }), /iron_furnaces 的版本 0\.0\.0 比上一份清单里的 0\.0\.1 还旧/);
  const changed = planRelease({ ...base, ...built('0.0.1', {}, { yes_steve_model: 11, core: 101 }), prev, notes: {} });
  assert.match(changed.warnings.join('\n'), /yes_steve_model 版本还是 0\.0\.1，但这次构建的文件大小（11）和已发布的（10）不同/);
  assert.match(changed.warnings.join('\n'), /核心版本还是 0\.0\.1，但这次构建的 jar 大小（101）/);
  assert.deepEqual(changed.files, [], '不覆盖已发布的文件');
});

test('the release folder gets new files first, then index.json; a published name with a different size stops it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-release-'));
  try {
    const src = path.join(dir, 'a.jar');
    fs.writeFileSync(src, 'abc');
    const out = path.join(dir, 'out');
    writeRelease(out, { index: { schema: 1 }, files: [{ from: src, to: 'plugins/a.jar', size: 3 }] });
    assert.equal(fs.readFileSync(path.join(out, 'plugins', 'a.jar'), 'utf8'), 'abc');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, 'index.json'), 'utf8')), { schema: 1 });
    assert.deepEqual(fs.readdirSync(path.join(out, 'plugins')), ['a.jar'], '没有留下 .tmp');
    fs.writeFileSync(src, 'abcd');
    assert.throws(() => writeRelease(out, { index: { schema: 2 }, files: [{ from: src, to: 'plugins/a.jar', size: 4 }] }), /已经存在且大小不同/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'index.json'), 'utf8')).schema, 1, '出错时不动 index.json');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('release arguments need the GitHub organisation and repository; notices are validated', () => {
  assert.throws(() => parseReleaseArgs([]), /--github-org 和 --github-repo/);
  assert.throws(() => parseReleaseArgs(['--github-org', 'a/b', '--github-repo', 'r']), /--github-org/);
  assert.equal(parseReleaseArgs(['--github-org', 'o', '--github-repo', 'r', '--date', '2026-10-20']).date, '2026-10-20');
  assert.throws(() => parseReleaseArgs(['--github-org', 'o', '--github-repo', 'r', '--date', '10/20']), /YYYY-MM-DD/);
  const ok = { id: 'x', date: '2026-10-20', title: 't', text: 'x', level: 'info', appMin: '0.0.1', until: '2026-12-31' };
  assert.equal(checkNotice(ok), ok);
  assert.throws(() => checkNotice({ ...ok, level: 'error' }), /level 只能是 info 或 warn/);
  assert.throws(() => checkNotice({ ...ok, appMax: '1' }), /appMax 不是/);
  assert.throws(() => checkNotice({ ...ok, title: '' }), /缺 title/);
});
