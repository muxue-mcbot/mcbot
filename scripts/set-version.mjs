#!/usr/bin/env node
// 改版本号，改完跑一遍 check-compat。
// 用法：
//   node scripts/set-version.mjs app 0.0.2                      主程序和核心：client-runtime/package.json（含 lock）、核心的 mod_version、compat.json 里核心的 jar 名
//   node scripts/set-version.mjs <插件 id> 0.0.3 [--core-min 0.0.2]   只改这个插件：它的 mod_version、compat.json 里它的 jar 名；--core-min 同时改它要求的核心最低版本
// 只改文字里的那几处，不重排文件格式。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseVersion, compareVersions } from './version.mjs';
import { loadCompat, checkCompat } from './check-compat.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 保留文件原来的换行（模组的文件是 CRLF）
function edit(file, change) {
  const raw = fs.readFileSync(file, 'utf8');
  const crlf = raw.includes('\r\n');
  const before = raw.replace(/\r\n/g, '\n');
  const after = change(before);
  if (after !== before) fs.writeFileSync(file, crlf ? after.replace(/\n/g, '\r\n') : after);
}

function replaceOnce(text, pattern, replacement, what) {
  pattern.lastIndex = 0;
  if (!pattern.test(text)) throw new Error(`找不到 ${what}`);
  return text.replace(pattern, replacement);
}

function setGradle(project, key, value) {
  edit(path.join(ROOT, project, 'gradle.properties'), (t) => replaceOnce(t, new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`, `${project}/gradle.properties 的 ${key}`));
}

const today = () => new Date().toLocaleDateString('sv-SE');

/** compat.json 里 adapters 中 id 为 id 的那一段（到下一个适配开始为止）的起止位置。 */
function adapterSpan(text, id) {
  const start = text.indexOf('"adapters"');
  const at = text.indexOf(`"id": "${id}"`, start);
  if (start < 0 || at < 0) throw new Error(`compat.json 里没有适配 ${id}`);
  const next = text.indexOf('\n    {', at);
  return [at, next < 0 ? text.length : next];
}

export function setAppVersion(version) {
  parseVersion(version);
  const compat = loadCompat(path.join(ROOT, 'compat.json'));
  const nameRe = /("name": "mcbot-client-runtime",\n\s*"version": ")[^"]+"/g;
  for (const f of ['package.json', 'package-lock.json']) {
    edit(path.join(ROOT, 'client-runtime', f), (t) => replaceOnce(t, nameRe, `$1${version}"`, `client-runtime/${f} 的 version`));
  }
  setGradle(compat.core.project, 'mod_version', version);
  const jar = `${path.basename(compat.core.project)}-${version}.jar`;
  edit(path.join(ROOT, 'compat.json'), (t) => stamp(replaceOnce(t, new RegExp(`("core": \\{[\\s\\S]*?"jar": ")[^"]+"`), `$1${jar}"`, '核心的 jar')));
  return { jar };
}

export function setPluginVersion(id, version, coreMin) {
  parseVersion(version);
  if (coreMin !== undefined) parseVersion(coreMin);
  const compat = loadCompat(path.join(ROOT, 'compat.json'));
  const adapter = compat.adapters.find((a) => a.id === id);
  if (!adapter) throw new Error(`compat.json 里没有插件 ${id}（可用：app、${compat.adapters.filter((a) => a.kind === 'addon').map((a) => a.id).join('、')}）`);
  if (adapter.kind !== 'addon') throw new Error(`${id} 是配置类适配，没有自己的 jar，不用改版本`);
  const coreVersion = gradleValue(compat.core.project, 'mod_version');
  if (coreMin !== undefined && compareVersions(coreMin, coreVersion) > 0) throw new Error(`--core-min ${coreMin} 比现在的核心 ${coreVersion} 还新，先改主程序版本`);
  setGradle(adapter.project, 'mod_version', version);
  if (coreMin !== undefined) setGradle(adapter.project, 'core_min', coreMin);
  const jar = `${path.basename(adapter.project)}-${version}.jar`;
  edit(path.join(ROOT, 'compat.json'), (t) => {
    const [a, b] = adapterSpan(t, id);
    let part = replaceOnce(t.slice(a, b), /("jar": ")[^"]+"/, `$1${jar}"`, `${id} 的 jar`);
    if (coreMin !== undefined) part = replaceOnce(part, /("coreMin": ")[^"]+"/, `$1${coreMin}"`, `${id} 的 coreMin`);
    return stamp(t.slice(0, a) + part + t.slice(b));
  });
  return { jar };
}

function gradleValue(project, key) {
  const line = fs.readFileSync(path.join(ROOT, project, 'gradle.properties'), 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
  return line?.slice(key.length + 1).trim();
}

const stamp = (t) => t.replace(/("updated": ")[^"]+"/, `$1${today()}"`);

export function parseSetVersionArgs(argv) {
  const [target, version, ...rest] = argv;
  if (!target || !version) throw new Error('用法：node scripts/set-version.mjs app <版本> | <插件 id> <版本> [--core-min <版本>]');
  let coreMin;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--core-min' && target !== 'app') coreMin = rest[++i];
    else throw new Error(`不支持的参数：${rest[i]}`);
  }
  if (rest.includes('--core-min') && coreMin === undefined) throw new Error('--core-min 后面要写版本');
  return { target, version, coreMin };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { target, version, coreMin } = parseSetVersionArgs(process.argv.slice(2));
    const r = target === 'app' ? setAppVersion(version) : setPluginVersion(target, version, coreMin);
    console.log(`${target} → ${version}${coreMin ? `（需要核心 ${coreMin} 及以上）` : ''}，jar：${r.jar}`);
    const problems = checkCompat(loadCompat(path.join(ROOT, 'compat.json')));
    if (problems.length) {
      console.error(`改完后 check-compat 还有 ${problems.length} 处不一致：\n- ${problems.join('\n- ')}`);
      process.exit(1);
    }
    console.log('check-compat 通过。别忘了重新用 gradle 构建改过的模组（插件依赖核心的 jar，核心先构建）。');
  } catch (e) { console.error(e.message); process.exit(1); }
}
