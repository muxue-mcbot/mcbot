#!/usr/bin/env node
// 8c 农夫乐事的隔离服实测，全程走真实 MCP：
//   1. 砧板：空砧板取、放没配方的东西、副手拿着东西时放、放了再放、拿错工具切都被拒绝；放一个卷心菜、用刀切、捡回叶子、空手取回；
//      砧板上摆着刀（carving）不能切、空手取回刀；
//   2. 宴席：拿错容器被拒绝；拿碗盛烤鸡（有剩菜）；镶馅南瓜最后一份方块消失；饭团拼盘不要容器；
//   3. 派：拿木棍切被拒绝；用刀切一块；切最后一块派消失；
//   4. 番茄：tend-crops survey 认出熟番茄和番茄苗；收的时候右键摘、藤留着回到 0 龄、番茄苗不动；
//   5. 厨锅：缺料报 MISSING_MATERIALS（碗单独一行）；没热源报 STATION_NOT_READY；手里拿着碗也能放好就走；来早了 STILL_COOKING；
//      到时间 machine 事件说做好了；回去取出；wait:true 站着等做好就取；近的锅里有别的菜等着盛就换一口；
//   6. 炉灶和平底锅：打火石点着炉灶、再点被拒绝；木棍、没热源的平底锅被拒绝；整组土豆放进炉灶上的平底锅、空手取回、再放；
//      到时间捡回烤好的土豆；
//   7. 蘑菇菌落：剪刀剪一个、还没长的被拒绝；
//   8. 橱柜和篮子：discover-containers 找到、container-list 列出、container-withdraw 取出；
//   9. 卷心菜、洋葱、稻米：tend-crops 收卷心菜和洋葱并补种，稻米只收上半截稻穗、下半截留着；
//  10. 关掉「给 AI 用」再开一个运行端：工具里没有农夫乐事，produce-item 带 skipStations，服务端不用锅（NO_RECIPE）。
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
  console.log('固定25568/25578；平坦世界 world；夹具区 x6790..6812 z6392..6410 y199 以上；约 2 分钟。');
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
    '没测（只有离线测试）：放进去不开始做（RECIPE_REFUSED）、区块卸载和换维度后的 machine 事件、泡在水里的平底锅。',
    '不支持也没测：在炉灶上直接烤（Bot 不进点着的炉灶旁边那一圈，烤好的捡不到）、在水里种稻米（tend-crops 不种）、篮子自己吸东西；平底锅烤好不发 machine 事件（模型按 readyInSeconds 回来捡）。'] };
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
const STOVE_LIGHT = `${FD}:stove/light`, SKILLET_ADD = `${FD}:skillet/add`, SKILLET_TAKE = `${FD}:skillet/take`, SHEAR = `${FD}:mushroom_colony/harvest`;
const INTERACTIONS = [PLACE, CUT, TAKE, SERVE, SLICE, STOVE_LIGHT, SKILLET_ADD, SKILLET_TAKE, SHEAR];
const [X0, X1, Z0, Z1, Y] = [6790, 6812, 6392, 6410, 200];
const BOARD = [6800, 201, 6400], CHICKEN = [6803, 201, 6400], PUMPKIN = [6805, 201, 6400], ROLLS = [6807, 201, 6400];
const PIE = [6803, 201, 6404], LAST_PIE = [6805, 201, 6404], TOMATO = [6800, 201, 6407], BUDDING = [6802, 201, 6407], POT = [6796, 201, 6404], POT2 = [6794, 201, 6404];
// 平底锅照玩家常用的摆法放在点着的炉灶上。Bot 走路不进点着的炉灶（以及岩浆块、营火）旁边那一圈格子，
// 站的地方离每个炉灶都至少隔一格，免得点着第二个炉灶后被围住走不出去
const COLD_STOVE = [6811, 201, 6393], PAN_STOVE = [6809, 201, 6397], SKILLET = [6809, 202, 6397], COLD_SKILLET = [6811, 201, 6396];
const COLONY = [6792, 201, 6394], YOUNG_COLONY = [6794, 201, 6394], CABINET = [6792, 201, 6398], BASKET = [6794, 201, 6398];
// 稻米下半截在平台这一层（四周是平台的石头，水流不出去），下面垫一格泥土，稻穗在上面一格
const CABBAGE = [6791, 201, 6409], ONION = [6793, 201, 6409], RICE = [6795, 200, 6409], PANICLES = [6795, 201, 6409];
const AT_BOARD = [6800.5, 201, 6402.5], AT_FEASTS = [6805.5, 201, 6402.5], AT_PIES = [6804.5, 201, 6406.5], AT_POT = [6798.5, 201, 6404.5];
const AT_STOVES = [6809.5, 201, 6394.5], AT_SHED = [6793.5, 201, 6396.5], AT_CROPS = [6793.5, 201, 6407.5];
let forced = false, tickSpeed;
try {
  const h = await hello();
  check('服务端装了农夫乐事附属模组：十个交互、厨锅工作站、插件说明都在 hello 里', INTERACTIONS.every(id => h.interactions?.includes(id)) &&
    h.workstations?.includes(`${FD}:cooking_pot`) && h.hints?.some(x => x.id === `${FD}:hint`), { interactions: h.interactions, workstations: h.workstations, hints: h.hints?.map(x => x.id) });
  check('服务端声明 produce-item、tend-crops、machine-status、use-item-on-block', ['produce-item', 'tend-crops', 'machine-status', 'use-item-on-block'].every(c => h.capabilities.includes(c)), h.capabilities);
  client = await connect(path.join(dir, 'runtime'));
  const tools = Object.fromEntries((await client.listTools()).tools.map(t => [t.name, t]));
  check('MCP：interact-block 列出十个农夫乐事交互并带插件说明，produce-item 说明里有厨锅', INTERACTIONS.every(id => tools['interact-block']?.inputSchema.properties.interaction.enum.includes(id)) &&
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
  // 玩家把刀摆在砧板上（carving，Bot 自己不会摆）：不能切，空手能取回
  await fixture(`setblock ${at(BOARD)} minecraft:air`);
  await fixture(`setblock ${at(BOARD)} ${FD}:cutting_board[facing=north]{Inventory:{Items:[{Slot:0,id:"${FD}:iron_knife",count:1}],Size:1},IsItemCarved:1b}`);
  const carved = await interact(BOARD, CUT, `${FD}:iron_knife`);
  check('砧板上摆着刀：拿刀切被拒绝，说是摆着的工具', codeOf(carved) === 'INTERACTION_NOT_READY' && /shows a tool/.test(JSON.stringify(carved.value)), carved.value);
  const knife = await interact(BOARD, TAKE);
  check('空手取回摆着的刀：succeeded，背包里多了一把铁刀，砧板空了', ok(knife) && gained(knife, `${FD}:iron_knife`) && knife.value.result.summary?.item === '' && count(await inventory(), `${FD}:iron_knife`) === 2, knife.value);

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
  // 近的那口锅里有一份别的菜等着盛：不碰它，用远一点那口
  await fixture(`setblock ${POT2[0]} ${Y} ${POT2[2]} minecraft:magma_block`);
  await fixture(`setblock ${at(POT2)} ${FD}:cooking_pot`);
  await fixture(`setblock ${at(POT)} minecraft:air`);
  await fixture(`setblock ${at(POT)} ${FD}:cooking_pot{Inventory:{Items:[{Slot:6,id:"${FD}:vegetable_soup",count:1}],Size:9},Container:{id:"minecraft:bowl",count:1}}`);
  await stand(AT_POT);
  for (const item of ['minecraft:brown_mushroom', 'minecraft:red_mushroom', 'minecraft:bowl']) await fixture(`give Claude ${item} 1`);
  const other = await settle(await tool('produce-item', { item: 'minecraft:mushroom_stew', count: 1 }));
  const busy = await command(`data get block ${at(POT)} Inventory.Items`);
  report.facts.switchedPot = { receipt: other.value, busyPot: busy };
  check('近的锅里有别的菜等着盛：不碰它，换另一口锅放好就走', ok(other) && other.value.result?.cooking === true && other.value.result?.station?.x === POT2[0] && other.value.result?.station?.z === POT2[2] &&
    /vegetable_soup/.test(busy) && !/mushroom/.test(busy), other.value);

  // 6. 炉灶和平底锅：炉灶只点火（给上面的锅加热）；平底锅烤好的东西掉在旁边，到时间回来捡
  await fixture('clear Claude');
  await fixture(`setblock ${at(COLD_STOVE)} ${FD}:stove[facing=south,lit=false]`);
  await fixture(`setblock ${at(PAN_STOVE)} ${FD}:stove[facing=south,lit=true]`);
  await fixture(`setblock ${at(SKILLET)} ${FD}:skillet[facing=south]`);
  await fixture(`setblock ${at(COLD_SKILLET)} ${FD}:skillet[facing=south]`);
  await stand(AT_STOVES);
  await hotbar(1, 'minecraft:potato', 3); await hotbar(2, 'minecraft:flint_and_steel'); await hotbar(3, 'minecraft:stick');
  const light = await interact(COLD_STOVE, STOVE_LIGHT, 'minecraft:flint_and_steel');
  check('打火石点炉灶：succeeded，炉灶点着了，打火石还在', ok(light) && light.value.result.summary?.lit === true && await isBlock(COLD_STOVE, `${FD}:stove[lit=true]`) && count(await inventory(), 'minecraft:flint_and_steel') === 1, light.value);
  const relight = await interact(COLD_STOVE, STOVE_LIGHT, 'minecraft:flint_and_steel');
  check('再点一次：INTERACTION_NOT_READY（已经点着）', codeOf(relight) === 'INTERACTION_NOT_READY' && /already lit/.test(JSON.stringify(relight.value)), relight.value);
  const stickPan = await interact(SKILLET, SKILLET_ADD, 'minecraft:stick');
  check('木棍放平底锅：INTERACTION_NOT_READY（没有营火配方）', codeOf(stickPan) === 'INTERACTION_NOT_READY' && /campfire recipe/.test(JSON.stringify(stickPan.value)), stickPan.value);
  const coldPan = await interact(COLD_SKILLET, SKILLET_ADD, 'minecraft:potato');
  check('下面没热源的平底锅：INTERACTION_NOT_READY，说没热源，土豆没少', codeOf(coldPan) === 'INTERACTION_NOT_READY' && /No heat/.test(JSON.stringify(coldPan.value)) && count(await inventory(), 'minecraft:potato') === 3, coldPan.value);
  const pan = await interact(SKILLET, SKILLET_ADD, 'minecraft:potato');
  check('炉灶上的平底锅放进整组 3 个土豆：succeeded，用掉 3 个，约 18 秒', ok(pan) && pan.value.result.consumedCount === 3 && pan.value.result.summary?.count === 3 && pan.value.result.summary?.readyInSeconds === 18 &&
    count(await inventory(), 'minecraft:potato') === 0, pan.value);
  const back = await interact(SKILLET, SKILLET_TAKE);
  const potatoes = count(await inventory(), 'minecraft:potato');
  check('空手取回平底锅里的土豆：succeeded，土豆回到背包，锅空了', ok(back) && gained(back, 'minecraft:potato') && back.value.result.summary?.item === '' && potatoes >= 2, back.value);
  const panAgain = await interact(SKILLET, SKILLET_ADD, 'minecraft:potato');
  const panStarted = Date.now();
  check('再放回去：succeeded', ok(panAgain) && count(await inventory(), 'minecraft:potato') === 0, panAgain.value);
  report.facts.skilletPotatoes = potatoes;

  // 7. 蘑菇菌落（下面是菌丝），8. 橱柜和篮子：等炉灶和平底锅的时候做
  await fixture(`setblock ${COLONY[0]} ${Y} ${COLONY[2]} minecraft:mycelium`);
  await fixture(`setblock ${YOUNG_COLONY[0]} ${Y} ${YOUNG_COLONY[2]} minecraft:mycelium`);
  await fixture(`setblock ${at(COLONY)} ${FD}:brown_mushroom_colony[age=3]`);
  await fixture(`setblock ${at(YOUNG_COLONY)} ${FD}:brown_mushroom_colony[age=0]`);
  await fixture(`setblock ${at(CABINET)} ${FD}:oak_cabinet[facing=south]{Items:[{Slot:0b,id:"minecraft:apple",count:3}]}`);
  await fixture(`setblock ${at(BASKET)} ${FD}:basket[facing=up]{Items:[{Slot:4b,id:"minecraft:carrot",count:4}]}`);
  await stand(AT_SHED);
  await hotbar(4, 'minecraft:shears');
  const sheared = await interact(COLONY, SHEAR, 'minecraft:shears');
  check('剪刀剪蘑菇菌落：succeeded，掉出一个棕色蘑菇，菌落 3→2', ok(sheared) && gained(sheared, 'minecraft:brown_mushroom') && sheared.value.result.summary?.age === 2 &&
    await isBlock(COLONY, `${FD}:brown_mushroom_colony[age=2]`), sheared.value);
  const young = await interact(YOUNG_COLONY, SHEAR, 'minecraft:shears');
  check('还没长的菌落：INTERACTION_NOT_READY', codeOf(young) === 'INTERACTION_NOT_READY' && await isBlock(YOUNG_COLONY, `${FD}:brown_mushroom_colony[age=0]`), young.value);
  const mushroom = await pickUp('minecraft:brown_mushroom', 1);
  check('捡回剪下的蘑菇', mushroom === 1, { mushroom });
  await stand(AT_SHED);
  const found = (await tool('discover-containers', { radius: 6, maxResults: 16 })).value;
  const refOf = (pos, id) => found.candidates?.find(c => c.position?.x === pos[0] && c.position?.z === pos[2] && c.id === id)?.containerRef;
  const cabinetRef = refOf(CABINET, `${FD}:oak_cabinet`), basketRef = refOf(BASKET, `${FD}:basket`);
  check('discover-containers 找到橡木橱柜和篮子', !!cabinetRef && !!basketRef, found);
  const cabinetList = await settle(await tool('container-list', { containerRef: cabinetRef }));
  check('container-list 橱柜：3 个苹果', ok(cabinetList) && /minecraft:apple/.test(JSON.stringify(cabinetList.value)), cabinetList.value);
  const apples = await settle(await tool('container-withdraw', { containerRef: cabinetRef, item: 'minecraft:apple', count: 2 }));
  check('container-withdraw 从橱柜取 2 个苹果', ok(apples) && count(await inventory(), 'minecraft:apple') === 2, apples.value);
  const carrots = await settle(await tool('container-withdraw', { containerRef: basketRef, item: 'minecraft:carrot', count: 4 }));
  check('container-withdraw 从篮子取 4 根胡萝卜', ok(carrots) && count(await inventory(), 'minecraft:carrot') === 4, carrots.value);

  // 回到炉灶旁：平底锅每个 6 秒，烤好的从锅边弹出来落在地上
  await stand(AT_STOVES);
  await wait(Math.max(0, panStarted + potatoes * 6000 + 2000 - Date.now()));
  report.facts.cookedDrops = await command(`execute as @e[type=item,x=${SKILLET[0]},y=201,z=${SKILLET[2]},distance=..5] run data get entity @s Pos`);
  const baked = await pickUp('minecraft:baked_potato', potatoes);
  check(`平底锅烤好 ${potatoes} 个土豆，都捡回来了（从炉灶旁一圈外面捡）`, baked >= potatoes, { baked });

  // 9. 卷心菜、洋葱（耕地上）和稻米（下半截在水里，上面是稻穗）
  await fixture('clear Claude');
  for (const pos of [CABBAGE, ONION]) await fixture(`setblock ${pos[0]} ${Y} ${pos[2]} minecraft:farmland[moisture=7]`);
  await fixture(`setblock ${at(CABBAGE)} ${FD}:cabbages[age=7]`);
  await fixture(`setblock ${at(ONION)} ${FD}:onions[age=7]`);
  await fixture(`setblock ${RICE[0]} ${Y - 1} ${RICE[2]} minecraft:dirt`);
  await fixture(`setblock ${at(RICE)} ${FD}:rice[age=3,supporting=true]`);
  await fixture(`setblock ${at(PANICLES)} ${FD}:rice_panicles[age=3]`);
  await stand(AT_CROPS);
  const field = { x: 6793, y: 201, z: 6409 };
  const cropSurvey = await settle(await tool('tend-crops', { survey: true, center: field, radius: 2 }));
  const seen = cropSurvey.value.result?.crops ?? {};
  check('survey：熟的卷心菜、洋葱、稻穗各 1，稻米下半截不算作物', seen[`${FD}:cabbages`]?.ripe === 1 && seen[`${FD}:onions`]?.ripe === 1 && seen[`${FD}:rice_panicles`]?.ripe === 1 && !seen[`${FD}:rice`], cropSurvey.value.result);
  const harvest = await settle(await tool('tend-crops', { center: field, radius: 2 }));
  report.facts.cropHarvest = harvest.value;
  inv = await inventory();
  const got = harvest.value.result?.harvested ?? {};
  check('tend-crops 收了卷心菜、洋葱、稻穗，捡到收成', ok(harvest) && got[`${FD}:cabbages`] === 1 && got[`${FD}:onions`] === 1 && got[`${FD}:rice_panicles`] === 1 &&
    count(inv, `${FD}:cabbage`) >= 1 && count(inv, `${FD}:rice_panicle`) >= 1, { result: harvest.value.result, inventory: inv.filter(s => s.count > 0).map(s => `${s.id}×${s.count}`) });
  check('卷心菜和洋葱补种回 0 龄，稻米下半截还在、稻穗没了（下半截会再长稻穗）', await isBlock(CABBAGE, `${FD}:cabbages[age=0]`) && await isBlock(ONION, `${FD}:onions[age=0]`) &&
    await isBlock(RICE, `${FD}:rice`) && await isBlock(PANICLES, 'minecraft:air'), {});

  // 10. 关掉「给 AI 用」：新的运行端带 --disabled-plugins，服务端模组照旧
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
  try { await command(`fill ${X0} ${Y - 1} ${Z0} ${X1} ${Y + 5} ${Z1} minecraft:air`); report.cleanup.push({ cleared: `${X0} ${Y - 1} ${Z0} ${X1} ${Y + 5} ${Z1}` }); } catch (error) { report.cleanup.push({ clearFailed: true, error: redact(error.message) }); }
  try { await command(`kill @e[type=item,x=6801,y=201,z=6401,distance=..20]`); } catch {}
  try { await command('clear Claude'); report.cleanup.push({ cleared: 'Claude inventory' }); } catch {}
  if (tickSpeed) { try { await command('gamerule randomTickSpeed ' + tickSpeed); report.cleanup.push({ randomTickSpeed: tickSpeed }); } catch {} }
  if (forced) { try { await command(`forceload remove ${X0} ${Z0} ${X1} ${Z1}`); report.cleanup.push({ forceloadRemoved: true }); } catch (error) { report.cleanup.push({ forceloadRemoveFailed: true, error: redact(error.message) }); } }
  report.finished = new Date().toISOString(); await save();
  console.log(`${report.result}: ${report.checks.filter(c => c.passed).length} checks; report ${path.relative(root, dir)}/report.json`);
}
