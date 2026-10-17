import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePublishArgs, publishPlan, filesToUpload } from '../../scripts/publish.mjs';

test('publish arguments: a target is required, ssh and dir go together and are checked', () => {
  assert.throws(() => parsePublishArgs([]), /--ssh\/--dir 或 --github/);
  assert.throws(() => parsePublishArgs(['--ssh', 'site-host']), /--ssh 和 --dir 要一起写/);
  assert.throws(() => parsePublishArgs(['--ssh', 'site-host; rm', '--dir', 'C:\\site']), /--ssh 只写主机名/);
  assert.throws(() => parsePublishArgs(['--ssh', 'site-host', '--dir', '/var/www']), /Windows 的绝对路径/);
  assert.throws(() => parsePublishArgs(['--ssh', 'site-host', '--dir', "C:\\a'b"]), /特殊字符/);
  const o = parsePublishArgs(['--ssh', 'site-host', '--dir', 'C:\\Users\\me\\Desktop\\site', '--github', '--dry-run']);
  assert.deepEqual([o.ssh, o.dir, o.github, o.dryRun], ['site-host', 'C:\\Users\\me\\Desktop\\site', true, true]);
});

test('publish arguments: downloads can go to a separate Linux server, but index.json still needs --ssh', () => {
  assert.throws(() => parsePublishArgs(['--files-ssh', 'files-host', '--github']), /--files-ssh 和 --files-dir 要一起写/);
  assert.throws(() => parsePublishArgs(['--files-ssh', 'files-host', '--files-dir', '/srv/downloads', '--github']), /还要用 --ssh\/--dir/);
  assert.throws(() => parsePublishArgs(['--files-ssh', 'files host', '--files-dir', '/srv/d', '--ssh', 'site-host', '--dir', 'C:\\site']), /--files-ssh 只写主机名/);
  for (const bad of ['C:\\site', 'srv/d', "/srv/a'b", '/srv/a;rm']) {
    assert.throws(() => parsePublishArgs(['--files-ssh', 'files-host', '--files-dir', bad, '--ssh', 'site-host', '--dir', 'C:\\site']), /Linux 的绝对路径/);
  }
  const o = parsePublishArgs(['--github', '--files-ssh', 'files-host', '--files-dir', '/srv/downloads', '--ssh', 'site-host', '--dir', 'C:\\site']);
  assert.deepEqual([o.filesSsh, o.filesDir, o.ssh, o.dir], ['files-host', '/srv/downloads', 'site-host', 'C:\\site']);
});

test('files to upload: same name and size is skipped, a different size stops, the rest are uploaded', () => {
  const files = [{ file: 'app/a.exe', size: 40 }, { file: 'core/c.jar', size: 4 }, { file: 'plugins/p.jar', size: 2 }];
  assert.deepEqual(filesToUpload(files, new Map([['app/a.exe', 40]]), '下载服务器'), ['core/c.jar', 'plugins/p.jar']);
  assert.deepEqual(filesToUpload(files, new Map(), '下载服务器'), ['app/a.exe', 'core/c.jar', 'plugins/p.jar']);
  assert.throws(() => filesToUpload(files, new Map([['core/c.jar', 5]]), '下载服务器'), /下载服务器上已有 core\/c\.jar，大小不同/);
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
