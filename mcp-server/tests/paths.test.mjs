import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { INSTALL_MARKER, PROGRAM_DIR, dataDir, isInstalled, memoryDir, runtimeDir } from '../../scripts/paths.mjs';

test('数据目录：MCBOT_HOME 优先；有安装标记用 %LOCALAPPDATA%\mcbot；开发环境就是程序目录', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-paths-'));
  try {
    assert.equal(PROGRAM_DIR, path.resolve(import.meta.dirname, '..', '..'));
    assert.equal(isInstalled(PROGRAM_DIR), false, '仓库里不放安装标记');
    assert.equal(dataDir(root, {}), root);
    assert.equal(runtimeDir(root, {}), path.join(root, 'runtime'));
    assert.equal(memoryDir(root, {}), path.join(root, 'memory'));
    fs.writeFileSync(path.join(root, INSTALL_MARKER), '{"app":"mcbot"}');
    assert.equal(isInstalled(root), true);
    assert.equal(dataDir(root, { LOCALAPPDATA: path.join(root, 'local') }), path.join(root, 'local', 'mcbot'));
    assert.equal(runtimeDir(root, { LOCALAPPDATA: 'L' }), path.join('L', 'mcbot', 'runtime'));
    assert.equal(dataDir(root, {}), path.join(os.homedir(), 'AppData', 'Local', 'mcbot'), '没有 LOCALAPPDATA 时按用户目录拼');
    assert.equal(dataDir(root, { MCBOT_HOME: path.join(root, 'home'), LOCALAPPDATA: 'L' }), path.join(root, 'home'));
    assert.equal(memoryDir(root, { MCBOT_HOME: path.join(root, 'home') }), path.join(root, 'home', 'memory'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
