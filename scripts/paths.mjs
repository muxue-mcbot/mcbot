// 程序目录和数据目录（docs/update_design.md 第一节）。没有状态。
// 程序目录：仓库或安装目录（scripts/ 的上一级），放 Node、运行端、脚本、compat.json、CLAUDE.md；Agent 的工作目录也是它。
// 数据目录：下面的 runtime/（配置、活动记录、下载缓存、dsh）和 memory/（人设、记忆）。安装包覆盖程序目录、卸载默认不删数据目录。
// 数据目录按程序目录定：环境变量 MCBOT_HOME > 程序目录里有安装标记 install.json（只有安装包里有）时用 %LOCALAPPDATA%\mcbot
// > 都没有就是开发环境，数据目录就是程序目录本身（仓库的 runtime/、memory/ 照旧）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROGRAM_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const INSTALL_MARKER = 'install.json';

/** 安装版（程序目录里有安装标记）。 */
export function isInstalled(root = PROGRAM_DIR) {
  return fs.existsSync(path.join(root, INSTALL_MARKER));
}

export function dataDir(root = PROGRAM_DIR, env = process.env) {
  if (env.MCBOT_HOME) return path.resolve(env.MCBOT_HOME);
  if (isInstalled(root)) return path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'mcbot');
  return root;
}
export const runtimeDir = (root = PROGRAM_DIR, env = process.env) => path.join(dataDir(root, env), 'runtime');
export const memoryDir = (root = PROGRAM_DIR, env = process.env) => path.join(dataDir(root, env), 'memory');
