import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseVersion, compareVersions, readAppVersion } from '../../scripts/version.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('versions compare segment by segment as numbers, not as strings', () => {
  assert.deepEqual(parseVersion('0.0.12'), [0, 0, 12]);
  assert.equal(compareVersions('0.0.10', '0.0.9'), 1);
  assert.equal(compareVersions('0.0.9', '0.1.0'), -1);
  assert.equal(compareVersions('0.1.0', '0.1.0'), 0);
  assert.equal(compareVersions('1.0.0', '0.99.99'), 1);
  for (const bad of ['0.1', '0.0.1-beta', 'v0.0.1', '01.0.0', '', undefined]) assert.throws(() => parseVersion(bad), /版本号格式不对/, String(bad));
  assert.equal(readAppVersion(ROOT), JSON.parse(fs.readFileSync(path.join(ROOT, 'client-runtime', 'package.json'), 'utf8')).version);
});

// 在临时目录里放一份仓库里 set-version、check-compat 会读写的文件，改的是副本
function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-version-'));
  for (const f of ['compat.json', 'client-runtime/package.json', 'client-runtime/package-lock.json', 'scripts/version.mjs', 'scripts/set-version.mjs', 'scripts/check-compat.mjs']) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
  }
  const compat = JSON.parse(fs.readFileSync(path.join(ROOT, 'compat.json'), 'utf8'));
  for (const project of [compat.core.project, ...compat.adapters.filter((a) => a.project).map((a) => a.project)]) {
    for (const f of ['gradle.properties', 'build.gradle', 'src/main']) fs.cpSync(path.join(ROOT, project, f), path.join(dir, project, f), { recursive: true });
  }
  const node = (args) => spawnSync(process.execPath, args, { cwd: dir, encoding: 'utf8' });
  const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
  return { dir, node, read, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('set-version changes the app (runtime, lock, core) or one plugin, keeps line endings, and check-compat agrees', () => {
  const s = sandbox();
  try {
    const app = s.node(['scripts/set-version.mjs', 'app', '0.0.12']);
    assert.equal(app.status, 0, app.stderr);
    assert.equal(JSON.parse(s.read('client-runtime/package.json')).version, '0.0.12');
    const lock = JSON.parse(s.read('client-runtime/package-lock.json'));
    assert.deepEqual([lock.version, lock.packages[''].version], ['0.0.12', '0.0.12']);
    assert.match(s.read('mods/mcbot-server-control/gradle.properties'), /^mod_version=0\.0\.12\r?$/m);
    assert.equal(JSON.parse(s.read('compat.json')).core.jar, 'mcbot-server-control-0.0.12.jar');

    const before = JSON.parse(s.read('compat.json'));
    const one = s.node(['scripts/set-version.mjs', 'iron_furnaces', '0.0.3', '--core-min', '0.0.12']);
    assert.equal(one.status, 0, one.stderr);
    const after = JSON.parse(s.read('compat.json'));
    const furnaces = after.adapters.find((a) => a.id === 'iron_furnaces');
    assert.deepEqual([furnaces.jar, furnaces.coreMin], ['mcbot-iron-furnaces-0.0.3.jar', '0.0.12']);
    const props = s.read('mods/mcbot-iron-furnaces/gradle.properties');
    assert.match(props, /^mod_version=0\.0\.3\r?$/m);
    assert.match(props, /^core_min=0\.0\.12\r?$/m);
    assert.equal(props.includes('\r\n'), fs.readFileSync(path.join(ROOT, 'mods/mcbot-iron-furnaces/gradle.properties'), 'utf8').includes('\r\n'), '换行保持原样');
    for (const a of after.adapters.filter((x) => x.id !== 'iron_furnaces')) assert.deepEqual(a, before.adapters.find((x) => x.id === a.id), `${a.id} 没动`);

    assert.match(s.node(['scripts/set-version.mjs', 'iron_furnaces', '0.0.4', '--core-min', '0.0.13']).stderr, /比现在的核心 0\.0\.12 还新/);
    assert.match(s.node(['scripts/set-version.mjs', 'app', '0.1']).stderr, /版本号格式不对/);
    assert.match(s.node(['scripts/set-version.mjs', 'nope', '0.0.1']).stderr, /没有插件 nope/);
    assert.match(s.node(['scripts/set-version.mjs', 'kaleidoscope_cookery_slots', '0.0.1']).stderr, /配置类适配/);
    assert.equal(s.node(['scripts/check-compat.mjs']).status, 0);
  } finally { s.cleanup(); }
});

test('check-compat catches version drift: runtime vs core, coreMin, hard-coded core range or jar in a plugin', () => {
  const s = sandbox();
  try {
    const write = (f, change) => fs.writeFileSync(path.join(s.dir, f), change(s.read(f)));
    write('client-runtime/package.json', (t) => t.replace(/"version": "[^"]+"/, '"version": "0.0.9"'));
    write('mods/mcbot-kaleidoscope-cookery/src/main/templates/META-INF/neoforge.mods.toml', (t) => t.replace('[${core_min},)', '[0.1.0,)'));
    write('mods/mcbot-yes-steve-model/build.gradle', (t) => t.replace(/def core = file\([^\n]+/, "def core = file('../mcbot-server-control/build/libs/mcbot-server-control-0.0.1.jar')"));
    write('mods/mcbot-iron-furnaces/gradle.properties', (t) => t.replace(/core_min=.*/, 'core_min=0.0.2'));
    write('compat.json', (t) => { const c = JSON.parse(t); c.adapters.find((a) => a.id === 'sophisticated_backpacks').coreMin = '9.0.0'; delete c.adapters.find((a) => a.id === 'iron_furnaces').coreMin; return JSON.stringify(c); });
    const r = s.node(['scripts/check-compat.mjs']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /client-runtime\/package\.json 是 0\.0\.9/);
    assert.match(r.stderr, /kaleidoscope_cookery：neoforge\.mods\.toml 对核心的要求是 \[0\.1\.0,\)/);
    assert.match(r.stderr, /yes_steve_model：build\.gradle 里核心的 jar 名/);
    assert.match(r.stderr, /sophisticated_backpacks：coreMin 9\.0\.0 比核心/);
    assert.match(r.stderr, /iron_furnaces：缺 coreMin/);
  } finally { s.cleanup(); }
});
