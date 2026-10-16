import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MachineBook, MachineWatch } from '../dist/machines.js';
import { EventJournal } from '../dist/events.js';

// 8b 放好就走、到时回来取：烧炼不等时记账，到时间读一下炉子，好了／停了／读不到都发 machine 事件，回去取了就销账。
const FURNACE = { x: 10, y: 64, z: -3 };
const loaded = (over = {}) => ({ operationId: 'load', sessionId: 's', name: 'smelt-item', status: 'succeeded', summary: 'Loaded',
  result: { furnace: FURNACE, type: 'minecraft:furnace', input: 'minecraft:raw_iron', added: 8, queued: 8, output: 'minecraft:iron_ingot', readyInSeconds: 80, ...over } });
const collected = (over = {}) => ({ operationId: 'collect', sessionId: 's', name: 'smelt-item', status: 'succeeded', summary: 'Collected', result: { furnace: FURNACE, type: 'minecraft:furnace', collected: 8, ...over } });
function setup(status, { dir } = {}) {
  let now = 1_000_000;
  const reads = [];
  const body = { hello: { capabilities: ['smelt-item', 'machine-status'] }, machineStatus: async position => { reads.push(position); if (status instanceof Error) throw status; return typeof status === 'function' ? status() : status; } };
  const events = new EventJournal();
  const book = new MachineBook(dir, dir ? 'world-1' : undefined);
  const watch = new MachineWatch(book, body, events, { intervalMs: 0, now: () => now });
  events.onOperation(operation => watch.operation(operation));
  return { watch, book, events, reads, advance: ms => { now += ms; }, machine: () => events.since(0, ['machine']) };
}
const done = { position: FURNACE, state: 'loaded', id: 'minecraft:furnace', supported: true, inputs: [], results: [{ item: 'minecraft:iron_ingot', count: 8 }], fuel: null, working: false, stalled: false };

test('a furnace loaded without waiting is checked when due and wakes the model once when done', async () => {
  const t = setup(done);
  await t.watch.tick('minecraft:overworld');
  t.events.recordOperation(loaded());
  assert.equal(t.book.list().length, 1);
  assert.equal(t.watch.waiting()[0].readyInSeconds, 82, 'ready time from the receipt plus slack');
  t.advance(60_000); await t.watch.tick('minecraft:overworld');
  assert.equal(t.reads.length, 0, 'not read before it is due');
  t.advance(30_000); await t.watch.tick('minecraft:overworld');
  assert.equal(t.machine().length, 1);
  assert.match(t.machine()[0].text, /烧好了.*8 个 iron_ingot.*smelt-item furnace=\{"x":10,"y":64,"z":-3\}/);
  t.advance(30_000); await t.watch.tick('minecraft:overworld');
  assert.equal(t.machine().length, 1, 'told once');
  assert.equal(t.watch.waiting()[0].told, true);
  t.events.deliverOperation(collected());
  await t.watch.tick('minecraft:overworld');
  assert.equal(t.book.list().length, 0, 'collected there: forgotten, and nothing left is no news');
  assert.equal(t.machine().length, 1);
});

test('still cooking is rechecked when the furnace says it will be done; no event until then', async () => {
  let left = 3;
  const t = setup(() => ({ ...done, inputs: left ? [{ item: 'minecraft:raw_iron', count: left }] : [], working: left > 0, ticksLeft: left * 200, results: [{ item: 'minecraft:iron_ingot', count: 8 - left }] }));
  await t.watch.tick('minecraft:overworld'); t.events.recordOperation(loaded());
  t.advance(90_000); await t.watch.tick('minecraft:overworld');
  assert.equal(t.machine().length, 0);
  assert.equal(t.watch.waiting()[0].readyInSeconds, 32, 'server lag: 3 items x 10 s left, plus slack');
  left = 0; t.advance(32_000); await t.watch.tick('minecraft:overworld');
  assert.equal(t.machine().length, 1);
});

test('stalled, unloaded, other dimension, too far and a vanished furnace each say so', async () => {
  const stalled = setup({ ...done, inputs: [{ item: 'minecraft:raw_iron', count: 5 }], results: [{ item: 'minecraft:iron_ingot', count: 3 }], working: false, stalled: true, fuel: null });
  await stalled.watch.tick('minecraft:overworld'); stalled.events.recordOperation(loaded());
  stalled.advance(90_000); await stalled.watch.tick('minecraft:overworld');
  assert.match(stalled.machine()[0].text, /停了.*还剩 5 个 raw_iron.*没燃料.*已经出了 3 个 iron_ingot/);

  const unloaded = setup({ position: FURNACE, state: 'unloaded' });
  await unloaded.watch.tick('minecraft:overworld'); unloaded.events.recordOperation(loaded());
  unloaded.advance(90_000); await unloaded.watch.tick('minecraft:overworld');
  assert.match(unloaded.machine()[0].text, /区块没加载/);

  const away = setup(done);
  await away.watch.tick('minecraft:overworld'); away.events.recordOperation(loaded());
  away.advance(90_000); await away.watch.tick('minecraft:the_nether');
  assert.match(away.machine()[0].text, /不在那个维度/);
  assert.equal(away.reads.length, 0, 'never reads the same coordinates in another dimension');

  const far = setup(Object.assign(new Error('Machine is more than 256 blocks away'), { code: 'OUT_OF_REACH' }));
  await far.watch.tick('minecraft:overworld'); far.events.recordOperation(loaded());
  far.advance(90_000); await far.watch.tick('minecraft:overworld');
  assert.match(far.machine()[0].text, /离得太远/);

  const gone = setup({ position: FURNACE, state: 'loaded', id: 'minecraft:air', supported: false });
  await gone.watch.tick('minecraft:overworld'); gone.events.recordOperation(loaded());
  gone.advance(90_000); await gone.watch.tick('minecraft:overworld');
  assert.match(gone.machine()[0].text, /炉子不见了/);
  assert.equal(gone.book.list().length, 0);
});

test('waiting with wait:true, failed loads and other tools are not tracked; a collect with more cooking is followed quietly', async () => {
  const t = setup(() => ({ ...done, inputs: [{ item: 'minecraft:raw_iron', count: 2 }], working: true, ticksLeft: 400 }));
  await t.watch.tick('minecraft:overworld');
  t.events.recordOperation(loaded({ collected: 8, leftInFurnace: 0 }));
  t.events.recordOperation({ ...loaded(), operationId: 'failed', status: 'failed' });
  t.events.recordOperation({ ...loaded(), operationId: 'other', name: 'craft-item' });
  assert.equal(t.book.list().length, 0);
  t.events.recordOperation(collected({ collected: 3 }));
  await t.watch.tick('minecraft:overworld');
  assert.equal(t.machine().length, 0, 'just collected: no event while it still cooks');
  assert.equal(t.book.list().length, 1, 'still cooking after the collect: followed');
  assert.equal(t.book.list()[0].quiet, false);
});

test('no processing time is not zero: a machine that cannot be read is never called done by the clock', async () => {
  const unread = setup({ position: FURNACE, state: 'loaded', id: 'minecraft:furnace', supported: false });
  await unread.watch.tick('minecraft:overworld'); unread.events.recordOperation(loaded({ readyInSeconds: 0 }));
  unread.advance(2000); await unread.watch.tick('minecraft:overworld');
  assert.equal(unread.machine().length, 1);
  assert.match(unread.machine()[0].text, /不知道要多久/);
  assert.doesNotMatch(unread.machine()[0].text, /应该好了/);

  let left = 2;
  const readable = setup(() => ({ ...done, inputs: left ? [{ item: 'minecraft:raw_iron', count: left }] : [], working: left > 0, results: [{ item: 'minecraft:iron_ingot', count: 8 - left }] }));
  await readable.watch.tick('minecraft:overworld'); readable.events.recordOperation(loaded({ readyInSeconds: undefined }));
  readable.advance(2000); await readable.watch.tick('minecraft:overworld');
  assert.equal(readable.machine().length, 0, 'readable and still working: no guess, keep reading');
  assert.equal(readable.watch.waiting()[0].readyInSeconds, 30, 'no ticksLeft: read again in 30 s');
  left = 0; readable.advance(30_000); await readable.watch.tick('minecraft:overworld');
  assert.match(readable.machine()[0].text, /烧好了/);
});

test('a brewing stage left in the stand wakes the model with what goes in next, then the last one says take them out', async () => {
  const STAND = { x: 4, y: 64, z: 4 };
  let reagent = [{ item: 'minecraft:sugar', count: 1 }];
  const t = setup(() => ({ position: STAND, state: 'loaded', id: 'minecraft:brewing_stand', supported: true, inputs: reagent, results: [{ item: 'minecraft:potion', count: 1 }, { item: 'minecraft:potion', count: 1 }],
    fuel: { item: 'minecraft:blaze_powder', count: 1 }, working: reagent.length > 0, ticksLeft: reagent.length ? 100 : 0, stalled: false }));
  const stage = (over = {}) => ({ operationId: `brew-${Math.random()}`, sessionId: 's', name: 'produce-item', status: 'succeeded', summary: 'Stage brewing',
    result: { item: 'minecraft:potion', potion: 'minecraft:swiftness', station: STAND, stage: 1, of: 2, bottles: 2, brewing: true, readyInSeconds: 20, nextIngredient: 'minecraft:sugar', ...over } });
  await t.watch.tick('minecraft:overworld');
  t.events.recordOperation(stage());
  assert.equal(t.book.list()[0].kind, 'brewing');
  t.advance(22_000); await t.watch.tick('minecraft:overworld');
  assert.equal(t.machine().length, 0, 'the stand says 5 s more: wait');
  reagent = []; t.advance(7_000); await t.watch.tick('minecraft:overworld');
  assert.match(t.machine()[0].text, /第 1\/2 段酿好了.*produce-item（item=minecraft:potion，potion=minecraft:swiftness.*加 sugar/);
  t.events.recordOperation({ ...stage({ stage: 2, nextIngredient: undefined }), operationId: 'brew-2' });
  t.advance(22_000); await t.watch.tick('minecraft:overworld');
  assert.match(t.machine()[1].text, /酿好了，2 瓶 swiftness.*把药水取出来/);
  t.events.recordOperation({ operationId: 'brewed', sessionId: 's', name: 'produce-item', status: 'succeeded', summary: 'Brewed', result: { station: STAND, made: 2 } });
  assert.equal(t.book.list().length, 0, 'taken out: forgotten');
  t.events.recordOperation(stage());
  t.events.recordOperation({ operationId: 'early', sessionId: 's', name: 'produce-item', status: 'failed', summary: 'STILL_BREWING', result: { station: STAND, code: 'STILL_BREWING' } });
  assert.equal(t.book.list().length, 1, 'coming too early keeps following it');
});

test('a cooking pot loaded and left is followed by sets left, told when done, and kept while the model comes too early', async () => {
  const POT = { x: 2, y: 65, z: 7 };
  let sets = 2, working = true;
  const t = setup(() => ({ position: POT, state: 'loaded', id: 'farmersdelight:cooking_pot', supported: true, machine: 'farmersdelight:cooking_pot',
    inputs: sets ? [{ item: 'minecraft:beef', count: sets }, { item: 'minecraft:carrot', count: sets }, { item: 'minecraft:potato', count: sets + 3 }] : [],
    results: [{ item: 'farmersdelight:beef_stew', count: 2 - sets }].filter(s => s.count > 0), fuel: null, working, ticksLeft: working && sets ? sets * 200 : -1, stalled: sets > 0 && !working }));
  const cook = (over = {}) => ({ operationId: `cook-${Math.random()}`, sessionId: 's', name: 'produce-item', status: 'succeeded', summary: 'Loaded',
    result: { item: 'farmersdelight:beef_stew', station: POT, type: 'farmersdelight:cooking_pot', cooking: true, collected: 0, sets: 2, readyInSeconds: 20, recipe: 'farmersdelight:cooking/beef_stew', ...over } });
  await t.watch.tick('minecraft:overworld');
  t.events.recordOperation(cook());
  assert.equal(t.book.list()[0].kind, 'cooking');
  assert.equal(t.book.list()[0].queued, 2);
  t.advance(15_000); await t.watch.tick('minecraft:overworld');
  assert.equal(t.reads.length, 0, 'not read before it is due');
  sets = 1; t.advance(7_000); await t.watch.tick('minecraft:overworld');
  assert.equal(t.machine().length, 0, 'one set still in: wait for the pot');
  assert.equal(t.watch.waiting()[0].readyInSeconds, 12, '200 ticks left plus slack');
  t.events.recordOperation({ operationId: 'early', sessionId: 's', name: 'produce-item', status: 'failed', summary: 'STILL_COOKING',
    result: { item: 'farmersdelight:beef_stew', station: POT, type: 'farmersdelight:cooking_pot', cooking: false, collected: 0, code: 'STILL_COOKING' } });
  assert.equal(t.book.list().length, 1, 'coming too early keeps following it');
  sets = 0; t.advance(12_000); await t.watch.tick('minecraft:overworld');
  assert.equal(t.machine().length, 1);
  assert.match(t.machine()[0].text, /cooking_pot \(2, 65, 7\) 做好了，里面有 2 个 farmersdelight:beef_stew.*produce-item（item=farmersdelight:beef_stew，和上次一样）/);
  t.events.recordOperation({ operationId: 'taken', sessionId: 's', name: 'produce-item', status: 'succeeded', summary: 'Collected',
    result: { item: 'farmersdelight:beef_stew', station: POT, type: 'farmersdelight:cooking_pot', cooking: false, collected: 2 } });
  assert.equal(t.book.list().length, 0, 'taken out: forgotten');
});

test('a cooking pot that stops, one taken while more cooks, a refused load and one that vanished', async () => {
  const POT = { x: 2, y: 65, z: 7 };
  const pot = (over = {}) => ({ position: POT, state: 'loaded', id: 'farmersdelight:cooking_pot', supported: true, inputs: [{ item: 'minecraft:beef', count: 3 }, { item: 'minecraft:carrot', count: 3 }],
    results: [{ item: 'farmersdelight:beef_stew', count: 1 }], fuel: null, working: false, ticksLeft: -1, stalled: true, ...over });
  const loadedPot = { operationId: 'cook', sessionId: 's', name: 'produce-item', status: 'succeeded', summary: 'Loaded',
    result: { item: 'farmersdelight:beef_stew', station: POT, type: 'farmersdelight:cooking_pot', cooking: true, sets: 4, readyInSeconds: 40 } };

  const stalled = setup(pot());
  await stalled.watch.tick('minecraft:overworld'); stalled.events.recordOperation(loadedPot);
  stalled.advance(45_000); await stalled.watch.tick('minecraft:overworld');
  assert.match(stalled.machine()[0].text, /停了：还有 3 份的材料.*热源.*已经做好 1 个 farmersdelight:beef_stew/);

  let left = 2;
  const more = setup(() => pot({ inputs: left ? [{ item: 'minecraft:beef', count: left }] : [], results: [], working: left > 0, stalled: false, ticksLeft: left * 200 }));
  await more.watch.tick('minecraft:overworld');
  more.events.recordOperation({ operationId: 'part', sessionId: 's', name: 'produce-item', status: 'succeeded', summary: 'Collected',
    result: { item: 'farmersdelight:beef_stew', station: POT, type: 'farmersdelight:cooking_pot', cooking: false, collected: 2, leftInStation: true } });
  assert.equal(more.book.list()[0].quiet, true, 'collected with more cooking: rechecked quietly');
  await more.watch.tick('minecraft:overworld');
  assert.equal(more.machine().length, 0);
  assert.equal(more.book.list()[0].quiet, false, 'still cooking after the collect: followed');
  assert.equal(more.book.list()[0].queued, 2);
  left = 0; more.advance(25_000); await more.watch.tick('minecraft:overworld');
  assert.equal(more.machine().length, 0, 'done but nothing waiting in it (taken by someone): no news');
  assert.equal(more.book.list().length, 0);

  const nothing = setup(pot({ inputs: [], results: [] }));
  await nothing.watch.tick('minecraft:overworld');
  nothing.events.recordOperation({ ...loadedPot, operationId: 'quiet', result: { ...loadedPot.result, cooking: false, collected: 1, leftInStation: true } });
  await nothing.watch.tick('minecraft:overworld');
  assert.equal(nothing.machine().length, 0, 'quiet recheck with nothing left is no news');
  assert.equal(nothing.book.list().length, 0);

  const refused = setup(pot());
  await refused.watch.tick('minecraft:overworld');
  refused.events.recordOperation(loadedPot);
  refused.events.recordOperation({ ...loadedPot, operationId: 'refused', status: 'failed', summary: 'RECIPE_REFUSED', result: { ...loadedPot.result, cooking: false, code: 'RECIPE_REFUSED' } });
  assert.equal(refused.book.list().length, 0, 'a refused load there is not followed');

  const gone = setup({ position: POT, state: 'loaded', id: 'minecraft:air', supported: false });
  await gone.watch.tick('minecraft:overworld'); gone.events.recordOperation(loadedPot);
  gone.advance(45_000); await gone.watch.tick('minecraft:overworld');
  assert.match(gone.machine()[0].text, /锅不见了/);
  assert.equal(gone.book.list().length, 0);
});

test('the list survives a restart of the runtime (per world file)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-machines-'));
  try {
    const first = setup(done, { dir });
    await first.watch.tick('minecraft:overworld'); first.events.recordOperation(loaded());
    const again = new MachineBook(dir, 'world-1');
    assert.equal(again.list().length, 1);
    assert.deepEqual(again.list()[0].position, FURNACE);
    assert.equal(new MachineBook(dir, 'world-2').list().length, 0, 'another world has its own list');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
