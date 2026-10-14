import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePublishArgs, publishPlan } from '../../scripts/publish.mjs';

test('publish arguments: a target is required, ssh and dir go together and are checked', () => {
  assert.throws(() => parsePublishArgs([]), /--ssh\/--dir 或 --github/);
  assert.throws(() => parsePublishArgs(['--ssh', 'uma']), /--ssh 和 --dir 要一起写/);
  assert.throws(() => parsePublishArgs(['--ssh', 'uma; rm', '--dir', 'C:\\site']), /--ssh 只写主机名/);
  assert.throws(() => parsePublishArgs(['--ssh', 'uma', '--dir', '/var/www']), /Windows 的绝对路径/);
  assert.throws(() => parsePublishArgs(['--ssh', 'uma', '--dir', "C:\\a'b"]), /特殊字符/);
  const o = parsePublishArgs(['--ssh', 'uma', '--dir', 'C:\\Users\\me\\Desktop\\site', '--github', '--dry-run']);
  assert.deepEqual([o.ssh, o.dir, o.github, o.dryRun], ['uma', 'C:\\Users\\me\\Desktop\\site', true, true]);
});

test('publish plan: the app release carries the installer and the core jar, each plugin its own tag', () => {
  const index = {
    app: { version: '0.0.2', notes: ['修了'], file: 'app/mcbot-setup-0.0.2.exe', tag: 'app-v0.0.2', size: 40, core: { file: 'core/mcbot-server-control-0.0.2.jar', size: 4 } },
    plugins: { iron_furnaces: { name: '铁炉', version: '0.0.1', notes: ['首次发布'], file: 'plugins/mcbot-iron-furnaces-0.0.1.jar', tag: 'iron_furnaces-v0.0.1', size: 2 } },
  };
  const { files, releases } = publishPlan(index);
  assert.deepEqual(files, [{ file: 'app/mcbot-setup-0.0.2.exe', size: 40 }, { file: 'core/mcbot-server-control-0.0.2.jar', size: 4 }, { file: 'plugins/mcbot-iron-furnaces-0.0.1.jar', size: 2 }]);
  assert.deepEqual(releases, [
    { tag: 'app-v0.0.2', title: 'mcbot 0.0.2', notes: ['修了'], files: ['app/mcbot-setup-0.0.2.exe', 'core/mcbot-server-control-0.0.2.jar'], latest: true },
    { tag: 'iron_furnaces-v0.0.1', title: '铁炉 插件 0.0.1', notes: ['首次发布'], files: ['plugins/mcbot-iron-furnaces-0.0.1.jar'], latest: false },
  ]);
});
