import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { modJar } from './jar-fixture.mjs';
import { checkGameCore, prepareServerPlay, supervise, parseArgs } from '../../scripts/start-server-play.mjs';

// 一个游戏目录：config/mcbot-server-control/connection.json，mods 里放给定的核心 jar
function game(jars = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-core-check-'));
  const control = path.join(dir, 'config', 'mcbot-server-control');
  fs.mkdirSync(control, { recursive: true });
  fs.mkdirSync(path.join(dir, 'mods'));
  for (const [name, bytes] of Object.entries(jars)) fs.writeFileSync(path.join(dir, 'mods', name), bytes);
  const connectionFile = path.join(control, 'connection.json');
  fs.writeFileSync(connectionFile, JSON.stringify({ protocol: 2, backend: 'server', username: 'ServerBot', worldId: 'w1', token: 't', endpoint: 'http://127.0.0.1:1/v2' }));
  return { dir, connectionFile, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
const core = (version, extra = '') => modJar('mcbot_server_control', version, { extra });
const ref = (version, jar = '') => ({ version, modId: 'mcbot_server_control', jar });

test('hosting is refused when the core in the game differs in version from the app; the old 0.1.0 counts as older', () => {
  const cases = [
    ['0.0.1', '0.0.2', /游戏中的核心模组（0\.0\.1）比主程序（0\.0\.2）旧：先关游戏，到插件页更新/],
    ['0.0.3', '0.0.2', /游戏中的核心模组（0\.0\.3）比主程序（0\.0\.2）新/],
    ['0.1.0', '0.0.2', /游戏中的核心模组（0\.1\.0）比主程序（0\.0\.2）旧/],
  ];
  for (const [have, want, re] of cases) {
    const g = game({ [`mcbot-server-control-${have}.jar`]: core(have) });
    try {
      assert.match(checkGameCore(g.connectionFile, { ref: ref(want) }).block, re, have);
      assert.throws(() => prepareServerPlay(parseArgs(['--connection-file', g.connectionFile, '--prepare-only']), { root: g.dir, coreCheck: (f) => checkGameCore(f, { ref: ref(want) }) }), re);
    } finally { g.cleanup(); }
  }
  const two = game({ 'mcbot-server-control-0.0.2.jar': core('0.0.2'), 'mcbot-server-control-0.0.1.jar': core('0.0.1') });
  try { assert.match(checkGameCore(two.connectionFile, { ref: ref('0.0.2') }).block, /有 2 个核心模组/); } finally { two.cleanup(); }
});

test('same version with different bytes or a missing core only warns; a matching core passes; other connection file locations are not checked', () => {
  const g = game({ 'mcbot-server-control-0.0.2.jar': core('0.0.2') });
  const local = path.join(g.dir, 'local.jar');
  try {
    fs.writeFileSync(local, core('0.0.2', '# rebuilt\n'));
    const warned = checkGameCore(g.connectionFile, { ref: ref('0.0.2', local) });
    assert.equal(warned.block, undefined);
    assert.match(warned.warn, /版本与主程序相同（0\.0\.2），但与本机构建的文件不同/);
    const p = prepareServerPlay(parseArgs(['--connection-file', g.connectionFile, '--prepare-only']), { root: g.dir, coreCheck: (f) => checkGameCore(f, { ref: ref('0.0.2', local) }) });
    assert.match(p.lines[0], /^注意：/);

    fs.copyFileSync(path.join(g.dir, 'mods', 'mcbot-server-control-0.0.2.jar'), local);
    assert.deepEqual(checkGameCore(g.connectionFile, { ref: ref('0.0.2', local) }), {});
    fs.rmSync(path.join(g.dir, 'mods', 'mcbot-server-control-0.0.2.jar'));
    assert.match(checkGameCore(g.connectionFile, { ref: ref('0.0.2') }).warn, /未找到核心模组/);
    assert.deepEqual(checkGameCore(local, { ref: ref('0.0.2') }), {}, '不在 config/mcbot-server-control 下就不检查');
  } finally { g.cleanup(); }
});

test('--wait refuses before it starts waiting for the world', async () => {
  let checked = false;
  await assert.rejects(supervise({ 'connection-file': 'x/config/mcbot-server-control/connection.json', username: 'ServerBot', wait: true }, {
    coreCheck: () => ({ block: '游戏中的核心模组（0.0.1）比主程序（0.0.2）旧：先关游戏，到插件页更新' }),
    check: async () => { checked = true; return { ok: false, wait: 'x' }; }, sleep: async () => {}, log: () => {}, pollMs: 0,
  }), /先关游戏，到插件页更新/);
  assert.equal(checked, false);
});
