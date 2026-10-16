#!/usr/bin/env node
// 8c 农夫乐事的隔离服实测，全程走真实 MCP：
//   1. 砧板：空砧板取、放没配方的东西、副手拿着东西时放、放了再放、拿错工具切都被拒绝；放一个卷心菜、用刀切、捡回叶子、空手取回；
//   2. 宴席：拿错容器被拒绝；拿碗盛烤鸡（有剩菜）；镶馅南瓜最后一份方块消失；饭团拼盘不要容器；
//   3. 派：拿木棍切被拒绝；用刀切一块；切最后一块派消失；
//   4. 番茄：tend-crops survey 认出熟番茄和番茄苗；收的时候右键摘、藤留着回到 0 龄、番茄苗不动；
//   5. 厨锅：缺料报 MISSING_MATERIALS（碗单独一行）；没热源报 STATION_NOT_READY；手里拿着碗也能放好就走；来早了 STILL_COOKING；
//      到时间 machine 事件说做好了；回去取出；wait:true 站着等做好就取；
//   6. 关掉「给 AI 用」再开一个运行端：工具里没有农夫乐事，produce-item 带 skipStations，服务端不用锅（NO_RECIPE）。
// 平坦世界 world，不启停服务器、不调用模型、不计算哈希。
// 需要：隔离服 mods 里有 farmersdelight 1.2.9、含 8c 接口的 mcbot-server-control 和 mcbot-farmers-delight；client-runtime 已构建。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const flags = process.argv.slice(2);
if (flags.includes('--help') || !flags.includes('--allow-fixture')) {
  console.log('MC_SERVER_DIR=<隔离服绝对路径> node scripts/server-farmers-delight-smoke.mjs --allow-fixture');
  console.log('固定25568/25578；平坦世界 world；夹具区 x6790..6812 z6392..6410 y200 以上；约 3 分钟。');
  process.exit(flags.includes('--help') ? 0 : 1);
}
assert(process.env.MC_SERVER_DIR && path.isAbsolute(process.env.MC_SERVER_DIR), '必须明确设置绝对路径MC_SERVER_DIR');
const serverDir = path.resolve(process.env.MC_SERVER_DIR);
assert(!serverDir.toLowerCase().startsWith(path.resolve('G:/mc/mcbot').toLowerCase()), '拒绝旧私库服务器');
const readJson = async file => JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
const { rcon, readServerProps } = await import('./rcon.mjs');
const props = readServerProps(serverDir);
assert.equal(props['server-port'], '25568'); assert.equal(props['rcon.port'], '25578');
const connectionFile = path.join(serverDir, 'config/mcbot-server-control/connection.json');
const connection = await readJson(connectionFile);
assert.equal(connection.username, 'Claude');
const { Client } = await import('../client-runtime/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js');
const { StdioClientTransport } = await import('../client-runtime/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js');

const dir = path.join(root, 'output', `server-farmers-delight-${new Date().toISOString().replaceAll(':', '-')}`);
await fs.mkdir(dir, { recursive: true });
const secrets = [connection.token, props['rcon.password']].filter(Boolean);
const redact = text => { let value = String(text); for (const secret of secrets) value = value.replaceAll(secret, '[redacted]'); return value; };
const report = { started: new Date().toISOString(), serverDir, checks: [], facts: {}, calls: [], cleanup: [],
  limitations: ['没有使用真实模型和测试玩家。', '只测农夫乐事 1.2.9。',
    '没测（只有离线测试）：锅里有别的菜时换锅、放进去不开始做（RECIPE_REFUSED）、砧板上放着刀（carving）、区块卸载和换维度后的 machine 事件。'] };
const save = () => fs.writeFile(path.join(dir, 'report.json'), redact(JSON.stringify(report, null, 2)) + '\n');
function check(name, passed, detail) { report.checks.push({ name, passed: !!passed, ...(detail === undefined ? {} : { detail }) }); assert(passed, name + (detail ? ' ' + redact(JSON.stringify(detail)).slice(0, 2500) : '')); console.log('PASS ' + name); }
const command = async text => (await rcon([text], { serverDir, timeoutMs: 5000 }))[0];
async function fixture(text) {
  const list = (await command('list')).trim().match(/:\s*([^\r\n]*)$/)?.[1].split(',').map(n => n.trim()).filter(Boolean) ?? [];
  assert(list.every(name => name === 'Claude'), '有其他玩家在线，拒绝修改夹具');
  const reply = await command(text); report.calls.push({ fixture: text, reply: redact(reply) });
  assert(!/not loaded|Unknown or incomplete|Incorrect argument|Malformed|No entity was found|Unknown block|Unknown item|Invalid|Expected/i.test(reply), '夹具命令被拒绝：' + text + ' → ' + redact(reply)); return reply;
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let client;
async function tool(name, args = {}) {
  const reply = await client.callTool({ name, arguments: args }, undefined, { timeout: 120000 });
  const text = reply.content[0].text; let value; try { value = JSON.parse(text); } catch { value = { text }; }
  report.calls.push({ tool: name, args, error: !!reply.isError, value });
  return { error: !!reply.isError, value };
}
async function settle(op, ms = 90000) {
  const deadline = Date.now() + ms;
  while (!op.error && op.value.status === 'running' && Date.now() < deadline) { await wait(500); op = await tool('get-operation', { operationId: op.value.operationId, details: true }); }
  return op;
}
async function hello() {
  const response = await fetch(connection.endpoint, { method: 'POST', headers: { authorization: `Bearer ${connection.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ method: 'hello', params: {} }) });
  return (await response.json()).result;
}
/** A runtime on the isolated server; extra flags (the plugin switch) go on its command line. The lease of a closed one may linger for its TTL. */
async function connect(runtime, extra = []) {
  let last;
  for (let attempt = 0; attempt < 6; attempt++) {
    const transport = new StdioClientTransport({ command: process.execPath, cwd: root, stderr: 'pipe',
      args: [path.join(root, 'client-runtime/dist/main.js'), '--body', 'server', '--connection-file', connectionFile, '--username', 'Claude', '--world-id', connection.worldId,
        '--runtime-dir', runtime, '--controller-id', randomUUID(), ...extra] });
    transport.stderr?.on('data', data => { fs.appendFile(path.join(dir, 'runtime-stderr.log'), redact(data.toString())).catch(() => {}); });
    const next = new Client({ name: 'farmers-delight-smoke', version: '1' });
    try { await next.connect(transport); await next.listTools(); return next; }
    catch (error) { last = error; try { await next.close(); } catch {} await wait(3000); }
  }
  throw last;
}
async function quiet() {
  const survival = (await tool('get-status', { include: ['survival'], details: false })).value.survival;
  await tool('set-reflexes', { expectedRevision: survival.policy.revision, autoEat: false, autoDefend: false, armed: false }); await tool('stop-action');
  await tool('wait-for-events', { timeoutSeconds: 0 });
}
const count = (inventory, id) => inventory.filter(s => s.id === id).reduce((n, s) => n + s.count, 0);
const inventory = async () => (await tool('get-status', { details: true })).value.inventory;
const machines = async () => (await tool('get-status', {})).value.machines ?? [];
const codeOf = op => op.error ? op.value.code : op.value.status === 'failed' || op.value.status === 'unknown' ? op.value.result?.code ?? op.value.code : null;
const ok = op => !op.error && op.value.status === 'succeeded';
const gained = (op, id) => (op.value.result?.gained ?? []).some(g => g.id === id);
const at = ([x, y, z]) => `${x} ${y} ${z}`, xyz = ([x, y, z]) => ({ x, y, z });
const isBlock = async (pos, block) => /passed/i.test(await command(`execute if block ${at(pos)} ${block}`));
const hotbar = (slot, item, n = 1) => fixture(`item replace entity Claude hotbar.${slot} with ${item} ${n}`);
const stand = async ([x, y, z]) => { await fixture(`tp Claude ${x} ${y} ${z}`); await wait(500); };
/** Machine events within the time limit (wait-for-events returns at most 30 s at a time). */
async function machineEvents(seconds) {
  const end = Date.now() + seconds * 1000, found = [];
  while (Date.now() < end && !found.length) {
    const reply = await tool('wait-for-events', { timeoutSeconds: Math.min(30, Math.max(1, Math.ceil((end - Date.now()) / 1000))), types: ['machine'] });
    const events = Array.isArray(reply.value) ? reply.value : reply.value.events ?? [];
    found.push(...events.filter(e => e.type === 'machine'));
  }
  return found;
}
async function interact(pos, interaction, item) {
  const reply = await settle(await tool('interact-block', { ...xyz(pos), interaction, ...(item ? { item } : { emptyHand: true }) }));
  // unknown receipts: keep the server's list of out-of-envelope effects for the report
  if (!reply.error && reply.value.status === 'unknown') report.facts[`unknown-${interaction}-${Date.now()}`] = reply.value.result?.unexpected;
  return reply;
}
/** Picks up what lies on the ground until the body holds `total` of the item (it may already have taken some walking past); returns how many it holds. */
async function pickUp(item, total) {
  const short = total - count(await inventory(), item);
  if (short > 0) report.facts[`collect-${item}-${Date.now()}`] = (await settle(await tool('collect-items', { item, count: short, radius: 4 }))).value;
  return count(await inventory(), item);
}

const FD = 'farmersdelight';
const PLACE = `${FD}:cutting_board/place`, CUT = `${FD}:cutting_board/cut`, TAKE = `${FD}:cutting_board/take`, SERVE = `${FD}:feast/serve`, SLICE = `${FD}:pie/slice`;
const [X0, X1, Z0, Z1, Y] = [6790, 6812, 6392, 6410, 200];
const BOARD = [6800, 201, 6400], CHICKEN = [6803, 201, 6400], PUMPKIN = [6805, 201, 6400], ROLLS = [6807, 201, 6400];
const PIE = [6803, 201, 6404], LAST_PIE = [6805, 201, 6404], TOMATO = [6800, 201, 6407], BUDDING = [6802, 201, 6407], POT = [6796, 201, 6404];
const AT_BOARD = [6800.5, 201, 6402.5], AT_FEASTS = [6805.5, 201, 6402.5], AT_PIES = [6804.5, 201, 6406.5], AT_POT = [6798.5, 201, 6404.5];
let forced = false, tickSpeed;
try {
  const h = await hello();
  check('服务端装了农夫乐事附属模组：五个交互、厨锅工作站、插件说明都在 hello 里', [PLACE, CUT, TAKE, SERVE, SLICE].every(id => h.interactions?.includes(id)) &&
    h.workstations?.includes(`${FD}:cooking_pot`) && h.hints?.some(x => x.id === `${FD}:hint`), { interactions: h.interactions, workstations: h.workstations, hints: h.hints?.map(x => x.id) });
  check('服务端声明 produce-item、tend-crops、machine-status、use-item-on-block', ['produce-item', 'tend-crops', 'machine-status', 'use-item-on-block'].every(c => h.capabilities.includes(c)), h.capabilities);
  client = await connect(path.join(dir, 'runtime'));
  const tools = Object.fromEntries((await client.listTools()).tools.map(t => [t.name, t]));
  check('MCP：interact-block 列出五个农夫乐事交互并带插件说明，produce-item 说明里有厨锅', [PLACE, CUT, TAKE, SERVE, SLICE].every(id => tools['interact-block']?.inputSchema.properties.interaction.enum.includes(id)) &&
    /\[farmersdelight\]/.test(tools['interact-block']?.description ?? '') && /farmersdelight:cooking_pot/.test(tools['produce-item']?.description ?? ''),
  { interact: tools['interact-block']?.description, produce: tools['produce-item']?.description });
  await quiet();

  await fixture(`forceload add ${X0} ${Z0} ${X1} ${Z1}`); forced = true;
  await command('time set day'); await command('weather clear'); await command('gamerule doMobSpawning false');
  // 番茄不自己长、耕地不变干，结果才数得准；结束时恢复原值
  tickSpeed = (await command('gamerule randomTickSpeed')).match(/(\d+)/)?.[1]; await command('gamerule randomTickSpeed 0');
  await fixture(`fill ${X0} ${Y} ${Z0} ${X1} ${Y} ${Z1} minecraft:stone`);
  await command(`fill ${X0} ${Y + 1} ${Z0} ${X1} ${Y + 5} ${Z1} minecraft:air`);
  await command(`kill @e[type=item,x=6801,y=201,z=6401,distance=..20]`);
  await fixture('gamemode survival Claude'); await fixture('clear Claude');
  await stand(AT_BOARD);

  // 1. 砧板
  await fixture(`setblock ${at(BOARD)} ${FD}:cutting_board[facing=north]`);
  await hotbar(0, `${FD}:cabbage`, 2); await hotbar(1, `${FD}:iron_knife`); await hotbar(2, 'minecraft:stick');
  const takeEmpty = await interact(BOARD, TAKE);
  check('空砧板空手取：INTERACTION_NOT_READY', codeOf(takeEmpty) === 'INTERACTION_NOT_READY', takeEmpty.value);
  const stick = await interact(BOARD, PLACE, 'minecraft:stick');
  check('放木棍（没有切割配方）：INTERACTION_NOT_READY，木棍还在', codeOf(stick) === 'INTERACTION_NOT_READY' && count(await inventory(), 'minecraft:stick') === 1, stick.value);
  await fixture('item replace entity Claude weapon.offhand with minecraft:stick');
  const offhand = await interact(BOARD, PLACE, `${FD}:cabbage`);
  check('副手拿着木棍时放料：INTERACTION_NOT_READY（砧板会拿副手那件），卷心菜没少', codeOf(offhand) === 'INTERACTION_NOT_READY' && /off hand/.test(JSON.stringify(offhand.value)) && count(await inventory(), `${FD}:cabbage`) === 2, offhand.value);
  await fixture('item replace entity Claude weapon.offhand with minecraft:air');
  const placed = await interact(BOARD, PLACE, `${FD}:cabbage`);
  const board = placed.value.result?.summary;
  check('放卷心菜：succeeded，只用掉 1 个，summary 写着卷心菜、能用铁刀切、会出卷心菜叶', ok(placed) && placed.value.result.consumedCount === 1 && board?.item === `${FD}:cabbage` &&
    board.tools?.includes(`${FD}:iron_knife`) && board.results?.includes(`${FD}:cabbage_leaf`) && count(await inventory(), `${FD}:cabbage`) === 1, placed.value);
  const again = await interact(BOARD, PLACE, `${FD}:cabbage`);
  check('砧板上有东西再放：INTERACTION_NOT_READY，卷心菜没少', codeOf(again) === 'INTERACTION_NOT_READY' && count(await inventory(), `${FD}:cabbage`) === 1, again.value);
  const wrongTool = await interact(BOARD, CUT, 'minecraft:stick');
  check('拿木棍切：INTERACTION_NOT_READY，说出该用的刀', codeOf(wrongTool) === 'INTERACTION_NOT_READY' && /iron_knife/.test(JSON.stringify(wrongTool.value)), wrongTool.value);
  const cut = await interact(BOARD, CUT, `${FD}:iron_knife`);
  check('用铁刀切：succeeded，砧板空了，卷心菜叶掉在旁边，刀还在', ok(cut) && cut.value.result.summary?.item === '' && gained(cut, `${FD}:cabbage_leaf`) && count(await inventory(), `${FD}:iron_knife`) === 1, cut.value);
  const leaves = await pickUp(`${FD}:cabbage_leaf`, 2);
  check('collect-items 捡回 2 片卷心菜叶（配方出 2 片）', leaves === 2, { leaves });
  await stand(AT_BOARD);
  const put = await interact(BOARD, PLACE, `${FD}:cabbage`);
  check('再放一个卷心菜：succeeded', ok(put) && count(await inventory(), `${FD}:cabbage`) === 0, put.value);
  const taken = await interact(BOARD, TAKE);
  check('空手取回：succeeded，卷心菜回到背包，砧板空了', ok(taken) && taken.value.result.summary?.item === '' && gained(taken, `${FD}:cabbage`) && count(await inventory(), `${FD}:cabbage`) === 1, taken.value);

  // 2. 宴席
  await stand(AT_FEASTS);
  await fixture(`setblock ${at(CHICKEN)} ${FD}:roast_chicken_block[facing=south]`);
  await fixture(`setblock ${at(PUMPKIN)} ${FD}:stuffed_pumpkin_block[facing=south,servings=1]`);
  await fixture(`setblock ${at(ROLLS)} ${FD}:rice_roll_medley_block[facing=south]`);
  await hotbar(3, 'minecraft:bowl', 2);
  const noBowl = await interact(CHICKEN, SERVE, 'minecraft:stick');
  check('拿木棍盛烤鸡：INTERACTION_NOT_READY，说要拿碗', codeOf(noBowl) === 'INTERACTION_NOT_READY' && /minecraft:bowl/.test(JSON.stringify(noBowl.value)), noBowl.value);
  const chicken = await interact(CHICKEN, SERVE, 'minecraft:bowl');
  let inv = await inventory();
  check('拿碗盛烤鸡：succeeded，用掉 1 个碗，拿到一份烤鸡，还剩 3 份', ok(chicken) && chicken.value.result.consumedCount === 1 && chicken.value.result.summary?.servings === 3 &&
    count(inv, `${FD}:roast_chicken`) === 1 && count(inv, 'minecraft:bowl') === 1, chicken.value);
  const pumpkin = await interact(PUMPKIN, SERVE, 'minecraft:bowl');
  inv = await inventory();
  check('镶馅南瓜最后一份：succeeded，方块没了（这道没有剩菜），拿到一份，碗用完', ok(pumpkin) && await isBlock(PUMPKIN, 'minecraft:air') && count(inv, `${FD}:stuffed_pumpkin`) === 1 && count(inv, 'minecraft:bowl') === 0, pumpkin.value);
  const rolls = await interact(ROLLS, SERVE, 'minecraft:stick');
  check('饭团拼盘不要容器：拿着木棍也能拿一份，木棍没少，还剩 7 份', ok(rolls) && rolls.value.result.consumedCount === 0 && rolls.value.result.summary?.servings === 7 &&
    (rolls.value.result.gained ?? []).length > 0 && count(await inventory(), 'minecraft:stick') === 1, rolls.value);

  // 3. 派
  await stand(AT_PIES);
  await fixture(`setblock ${at(PIE)} ${FD}:apple_pie[facing=south]`);
  await fixture(`setblock ${at(LAST_PIE)} ${FD}:apple_pie[facing=south,bites=3]`);
  const stickPie = await interact(PIE, SLICE, 'minecraft:stick');
  check('拿木棍切派：被拒绝（只认刀），派没动', !ok(stickPie) && codeOf(stickPie) !== null && await isBlock(PIE, `${FD}:apple_pie[bites=0]`), stickPie.value);
  const slice = await interact(PIE, SLICE, `${FD}:iron_knife`);
  check('用刀切苹果派：succeeded，掉出一块，bites 0→1', ok(slice) && slice.value.result.summary?.bites === 1 && gained(slice, `${FD}:apple_pie_slice`), slice.value);
  const first = await pickUp(`${FD}:apple_pie_slice`, 1);
  check('捡回那一块派', first === 1, { first });
  await stand(AT_PIES);
  const last = await interact(LAST_PIE, SLICE, `${FD}:iron_knife`);
  check('切最后一块：派没了，又掉出一块', ok(last) && await isBlock(LAST_PIE, 'minecraft:air') && gained(last, `${FD}:apple_pie_slice`), last.value);
  const second = await pickUp(`${FD}:apple_pie_slice`, 2);
  check('捡回最后一块', second === 2, { second });

  // 4. 番茄
  for (const pos of [TOMATO, BUDDING]) await fixture(`setblock ${pos[0]} ${Y} ${pos[2]} minecraft:farmland[moisture=7]`);
  await fixture(`setblock ${at(TOMATO)} ${FD}:tomatoes[age=3]`);
  await fixture(`setblock ${at(BUDDING)} ${FD}:budding_tomatoes[age=2]`);
  const center = { x: 6801, y: 201, z: 6407 };
  const survey = await settle(await tool('tend-crops', { survey: true, center, radius: 2 }));
  const crops = survey.value.result?.crops ?? {};
  report.facts.tomatoSurvey = survey.value.result;
  check('survey：熟番茄 1 棵，番茄苗算在长', crops[`${FD}:tomatoes`]?.ripe === 1 && crops[`${FD}:budding_tomatoes`]?.growing === 1 && !crops[`${FD}:budding_tomatoes`]?.ripe, survey.value.result);
  const tomatoesBefore = count(await inventory(), `${FD}:tomato`);
  const pick = await settle(await tool('tend-crops', { center, radius: 2 }));
  report.facts.tomatoPick = pick.value;
  check('tend-crops 右键摘了番茄：harvested 1、没补种，捡到番茄', ok(pick) && pick.value.result?.harvested?.[`${FD}:tomatoes`] === 1 && !pick.value.result?.replanted &&
    count(await inventory(), `${FD}:tomato`) > tomatoesBefore, pick.value);
  check('番茄藤还在、回到 0 龄，番茄苗没动', await isBlock(TOMATO, `${FD}:tomatoes[age=0]`) && await isBlock(BUDDING, `${FD}:budding_tomatoes[age=2]`), {});

  // 5. 厨锅：下面先是石头（没热源）
  await stand(AT_POT);
  await fixture(`setblock ${at(POT)} ${FD}:cooking_pot`);
  await fixture('clear Claude');
  const stew = { item: `${FD}:beef_stew`, count: 2 };
  const missing = await settle(await tool('produce-item', stew));
  const lines = missing.value.result?.missing ?? [];
  check('什么都没带：MISSING_MATERIALS，列出胡萝卜等，碗单独一行（container）', codeOf(missing) === 'MISSING_MATERIALS' && lines.some(l => l.container === true && l.options?.includes('minecraft:bowl')) &&
    lines.some(l => l.options?.includes('minecraft:carrot')), missing.value);
  // 碗拿在手上：右键锅会是盛菜，开锅前要换到空手
  await fixture('item replace entity Claude weapon.mainhand with minecraft:bowl 2');
  for (const item of ['minecraft:beef', 'minecraft:carrot', 'minecraft:potato']) await fixture(`give Claude ${item} 2`);
  const cold = await settle(await tool('produce-item', stew));
  inv = await inventory();
  check('锅下面没热源：STATION_NOT_READY，说了要热源，东西都还在', codeOf(cold) === 'STATION_NOT_READY' && /heat/i.test(JSON.stringify(cold.value)) && count(inv, 'minecraft:beef') === 2 && count(inv, 'minecraft:bowl') === 2, cold.value);
  await fixture(`setblock ${POT[0]} ${Y} ${POT[2]} minecraft:magma_block`);
  // 刚才那次开锅前已经换到空手，把碗放回此刻手上那格，再测一次拿着碗开锅
  await fixture('clear Claude minecraft:bowl'); await fixture('item replace entity Claude weapon.mainhand with minecraft:bowl 2');
  const load = await settle(await tool('produce-item', stew));
  inv = await inventory();
  report.facts.load = load.value;
  check('放好就走（手里原来拿着碗）：succeeded，cooking:true，2 份、放了 2 个碗，约 20 秒', ok(load) && load.value.result?.cooking === true && load.value.result?.sets === 2 &&
    load.value.result?.containersAdded === 2 && load.value.result?.readyInSeconds === 20 && count(inv, 'minecraft:beef') === 0 && count(inv, 'minecraft:bowl') === 0, load.value);
  const listed = await machines();
  check('get-status 列出等着的这口锅', listed.some(m => m.position.x === POT[0] && m.position.z === POT[2]), listed);
  const early = await settle(await tool('produce-item', stew));
  check('来早了：STILL_COOKING，什么都没拿', codeOf(early) === 'STILL_COOKING' && count(await inventory(), `${FD}:beef_stew`) === 0, early.value);
  const events = await machineEvents(50);
  report.facts.cookEvents = events;
  check('做好了叫醒：里面有 2 份牛肉汤，说了用 produce-item 取', /做好了，里面有 2 个 farmersdelight:beef_stew.*produce-item（item=farmersdelight:beef_stew/.test(events[0]?.text ?? ''), events);
  const collect = await settle(await tool('produce-item', stew));
  check('回去取：succeeded，取出 2 份牛肉汤', ok(collect) && collect.value.result?.collected === 2 && count(await inventory(), `${FD}:beef_stew`) === 2, collect.value);
  await wait(4000);
  check('取完后这口锅不在等着的列表里', !(await machines()).some(m => m.position.x === POT[0] && m.position.z === POT[2]));
  for (const item of ['minecraft:brown_mushroom', 'minecraft:red_mushroom', 'minecraft:bowl']) await fixture(`give Claude ${item} 1`);
  const waited = await settle(await tool('produce-item', { item: 'minecraft:mushroom_stew', count: 1, wait: true }));
  inv = await inventory();
  check('wait:true：站着等，做好就取，拿到 1 份蘑菇煲，碗用掉', ok(waited) && waited.value.result?.collected === 1 && count(inv, 'minecraft:mushroom_stew') === 1 && count(inv, 'minecraft:bowl') === 0, waited.value);

  // 6. 关掉「给 AI 用」：新的运行端带 --disabled-plugins，服务端模组照旧
  await client.close(); client = undefined; await wait(1000);
  client = await connect(path.join(dir, 'runtime-off'), ['--disabled-plugins', 'farmers_delight', '--compat-file', path.join(root, 'compat.json')]);
  await quiet();
  const off = Object.fromEntries((await client.listTools()).tools.map(t => [t.name, t]));
  check('关掉后：interact-block 里没有农夫乐事的交互，任何工具说明里都没有农夫乐事', !(off['interact-block']?.inputSchema.properties.interaction.enum ?? []).some(id => id.startsWith(`${FD}:`)) &&
    !Object.values(off).some(t => /farmersdelight/.test(t.description ?? '')), { interact: off['interact-block']?.inputSchema.properties.interaction.enum, produce: off['produce-item']?.description });
  await stand(AT_POT);
  for (const item of ['minecraft:beef', 'minecraft:carrot', 'minecraft:potato', 'minecraft:bowl']) await fixture(`give Claude ${item} 1`);
  const skipped = await settle(await tool('produce-item', { item: `${FD}:beef_stew`, count: 1 }));
  inv = await inventory();
  check('关掉后 produce-item 牛肉汤：NO_RECIPE（skipStations 让服务端不用这口锅），东西都还在', codeOf(skipped) === 'NO_RECIPE' && count(inv, 'minecraft:beef') === 1 && count(inv, 'minecraft:bowl') === 1, skipped.value);
  report.result = 'passed';
} catch (error) {
  report.result = 'failed'; report.error = redact(error.stack ?? error.message); process.exitCode = 1; console.error(redact(error.message));
} finally {
  try { await tool('stop-action'); } catch {}
  try { await client?.close(); } catch {}
  // 平台要拆掉：先回到平坦世界的地面，免得摔下去
  try { await command('tp Claude 6801.5 -60 6390.5'); await wait(500); } catch {}
  try { await command(`fill ${X0} ${Y} ${Z0} ${X1} ${Y + 5} ${Z1} minecraft:air`); report.cleanup.push({ cleared: `${X0} ${Y} ${Z0} ${X1} ${Y + 5} ${Z1}` }); } catch (error) { report.cleanup.push({ clearFailed: true, error: redact(error.message) }); }
  try { await command(`kill @e[type=item,x=6801,y=201,z=6401,distance=..20]`); } catch {}
  try { await command('clear Claude'); report.cleanup.push({ cleared: 'Claude inventory' }); } catch {}
  if (tickSpeed) { try { await command('gamerule randomTickSpeed ' + tickSpeed); report.cleanup.push({ randomTickSpeed: tickSpeed }); } catch {} }
  if (forced) { try { await command(`forceload remove ${X0} ${Z0} ${X1} ${Z1}`); report.cleanup.push({ forceloadRemoved: true }); } catch (error) { report.cleanup.push({ forceloadRemoveFailed: true, error: redact(error.message) }); } }
  report.finished = new Date().toISOString(); await save();
  console.log(`${report.result}: ${report.checks.filter(c => c.passed).length} checks; report ${path.relative(root, dir)}/report.json`);
}
