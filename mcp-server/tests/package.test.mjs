import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSafeStage, parsePackageArgs, findIscc, DATA_DIRS, ISS } from '../../scripts/package.mjs';
import { INSTALL_MARKER } from '../../scripts/paths.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// 打包前会清空目标目录：里面有用户数据，或者目标是仓库本身、它的上级，都要拒绝
test('the package stage is refused when it holds runtime/ or memory/, or is the repo or above it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-stage-'));
  try {
    assert.doesNotThrow(() => assertSafeStage(path.join(dir, 'mcbot-0.0.1-win-x64')), '还不存在的目录可以');
    for (const d of DATA_DIRS) {
      const stage = path.join(dir, `with-${d}`);
      fs.mkdirSync(path.join(stage, d), { recursive: true });
      assert.throws(() => assertSafeStage(stage), new RegExp(`里有 ${d}.*拒绝打包`));
    }
    assert.throws(() => assertSafeStage(ROOT), /仓库或仓库的上级目录/);
    assert.throws(() => assertSafeStage(path.dirname(ROOT)), /仓库或仓库的上级目录/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('package arguments: installer on by default, --no-installer and --iscc, old --no-zip rejected', () => {
  assert.equal(parsePackageArgs([]).installer, true);
  assert.equal(parsePackageArgs(['--no-installer']).installer, false);
  assert.equal(parsePackageArgs(['--iscc', 'C:/x/ISCC.exe']).iscc, path.resolve('C:/x/ISCC.exe'));
  assert.throws(() => parsePackageArgs(['--no-zip']), /不支持的参数/);
  assert.throws(() => findIscc(path.join(os.tmpdir(), 'no-such-ISCC.exe')), /未找到/);
});

// 安装标记的文件名、数据目录的位置是和 WebUI（scripts/paths.mjs）的约定，安装脚本也按这个写
test('the installer script installs per user, keeps data in %LOCALAPPDATA%\\mcbot and asks before deleting it', () => {
  assert.equal(INSTALL_MARKER, 'install.json');
  const iss = fs.readFileSync(ISS, 'utf8');
  assert.ok(iss.startsWith('\uFEFF'), '带 BOM，Inno Setup 才按 UTF-8 读中文');
  assert.match(iss, /^PrivilegesRequired=lowest$/m);
  assert.match(iss, /^DefaultDirName=\{localappdata\}\\Programs\\mcbot$/m);
  assert.match(iss, /^CloseApplications=yes$/m);
  assert.match(iss, /Result := ExpandConstant\('\{localappdata\}\\mcbot'\)/);
  assert.match(iss, /not UninstallSilent/, '静默卸载不删数据');
  assert.match(iss, /Source: "\{#MarkerFile\}"; DestDir: "\{app\}"; DestName: "install\.json"/, '安装标记只从安装包装进程序目录');
  assert.match(iss, /SELECT ProcessId, ExecutablePath, CommandLine FROM Win32_Process/, '自定义 Node 跑程序目录脚本的进程也要认出来');
  assert.match(iss, /function PrepareToInstall\(/);
  assert.match(iss, /MB_YESNO or MB_DEFBUTTON2/, '默认按钮是“否”');
  assert.doesNotMatch(iss.match(/^\[Run\]\r?\n[^[]*/m)[0], /skipifsilent/, '静默安装装完也要重新打开 WebUI');
});

// 10-15 起快捷方式和装完后打开的都是桌面窗口 mcbot.exe（shell/），安装和卸载前连它一起结束，没有 WebView2 时补装
test('the installer opens the desktop window mcbot.exe, closes it before replacing files, and installs WebView2 when missing', () => {
  const iss = fs.readFileSync(ISS, 'utf8');
  assert.match(iss, /^#define AppExe "\{app\}\\mcbot\.exe"$/m);
  for (const section of ['Icons', 'Run']) {
    const body = iss.match(new RegExp(`^\\[${section}\\]\\r?\\n[^[]*`, 'm'))[0];
    assert.match(body, /Filename: "\{#AppExe\}"/);
    assert.doesNotMatch(body, /node\.exe|webui\.mjs/, `${section} 不再直接跑 node`);
  }
  assert.match(iss, /WHERE Name = ''node\.exe'' OR Name = ''mcbot\.exe''/);
  assert.match(iss, /function HasWebView2\(/);
  assert.match(iss, /if CurStep = ssPostInstall then InstallWebView2\(\)/);
});
