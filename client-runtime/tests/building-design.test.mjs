import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ServerBody } from '../dist/server-body.js';
import { createMcpServer } from '../dist/mcp.js';
import { EventJournal } from '../dist/events.js';
import { BlueprintShelf, editBlueprint, resolveCells, shapeCells, roofCells } from '../dist/blueprints.js';
import { blockProperties, detectFloors, renderVoxels, textPlan } from '../dist/render.js';
import { designGuide } from '../dist/design-guide.js';
import { parseState } from '../dist/blueprints.js';
import { mockServerControl, serverCapabilities } from './mock-server-control.mjs';

const p = (x, y, z) => ({ x, y, z });
const cellsAt = cells => (x, y, z) => cells.findLast(c => c.x === x && c.y === y && c.z === z)?.state;
const voxelsOf = cells => cells.filter(c => c.state !== 'air').map(c => ({ x: c.x, y: c.y, z: c.z, ...parseState(c.state) }));
const guideExample = () => JSON.parse(/```json\n([\s\S]*?)```/.exec(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'building-guide.md'), 'utf8'))[1]);
const exampleCells = () => { const d = guideExample(); return resolveCells({ shapes: d.shapes, palette: d.palette, blocks: d.blocks.map(b => ({ x: b.x, y: b.y, z: b.z, state: b.block })) }); };

test('palette: "@role" anywhere a block goes, with extra properties; unknown or chained roles are refused', () => {
  const cells = resolveCells({ palette: { wall: 'oak_planks', frame: 'spruce_log[axis=y]' }, shapes: [{ shape: 'fill', from: p(0, 0, 0), to: p(1, 0, 0), block: '@wall' }], blocks: [{ x: 5, y: 0, z: 0, state: '@frame[axis=x]' }] });
  assert.deepEqual(cells.map(c => c.state), ['oak_planks', 'oak_planks', 'spruce_log[axis=x]']);
  assert.throws(() => resolveCells({ palette: { wall: 'stone' }, blocks: [{ x: 0, y: 0, z: 0, state: '@roof' }] }), /palette 里没有 @roof（有：@wall）/);
  assert.throws(() => resolveCells({ palette: { a: '@b', b: 'stone' }, blocks: [{ x: 0, y: 0, z: 0, state: '@a' }] }), /不能再引用/);
});

test('logs along a line lie the way it runs; other blocks and a given axis are left alone', () => {
  assert.equal(shapeCells({ shape: 'line', from: p(0, 0, 0), to: p(4, 0, 0), block: 'oak_log' })[0].state, 'oak_log[axis=x]');
  assert.equal(shapeCells({ shape: 'line', from: p(0, 0, 0), to: p(0, 0, 4), block: 'stripped_spruce_log' })[0].state, 'stripped_spruce_log[axis=z]');
  assert.equal(shapeCells({ shape: 'line', from: p(0, 0, 0), to: p(0, 4, 0), block: 'quartz_pillar' })[0].state, 'quartz_pillar[axis=y]');
  assert.equal(shapeCells({ shape: 'line', from: p(0, 0, 0), to: p(4, 0, 0), block: 'stone_bricks' })[0].state, 'stone_bricks');
  assert.equal(shapeCells({ shape: 'line', from: p(0, 0, 0), to: p(4, 0, 0), block: 'oak_log[axis=y]' })[0].state, 'oak_log[axis=y]');
  assert.throws(() => shapeCells({ shape: 'line', from: p(0, 0, 0), to: p(5000, 0, 0), block: 'stone' }), /line 太大/);
});

test('box: walls round the sides, floor inside, beams lying along the bottom and top rings, posts upright at corners and every pillarEvery', () => {
  const at = cellsAt(resolveCells({ shapes: [{ shape: 'box', from: p(0, 0, 0), to: p(4, 3, 4), block: 'white_terracotta', frame: 'spruce_log', floor: 'oak_planks', pillarEvery: 2 }] }));
  assert.equal(at(1, 1, 0), 'white_terracotta');
  assert.equal(at(2, 2, 2), undefined, 'the inside is left as it is');
  assert.equal(at(2, 0, 2), 'oak_planks');
  assert.equal(at(2, 3, 2), undefined, 'no ceiling given');
  assert.equal(at(1, 0, 0), 'spruce_log[axis=x]');
  assert.equal(at(0, 3, 1), 'spruce_log[axis=z]');
  for (const [x, z] of [[0, 0], [2, 0], [4, 4], [0, 2]]) assert.equal(at(x, 1, z), 'spruce_log[axis=y]', `post at ${x},${z}`);
  assert.equal(shapeCells({ shape: 'box', from: p(0, 0, 0), to: p(2, 1, 2), block: 'stone' }).length, 16, 'without a frame it is walls');
});

test('window: glass in the opening, recess sets it one in, the sill goes outside under it, trim frames it; it has to lie on one wall', () => {
  const at = cellsAt(resolveCells({ shapes: [{ shape: 'window', from: p(1, 1, 4), to: p(2, 2, 4), block: 'glass_pane', facing: 'south', recess: true, sill: 'oak_stairs', trim: 'stripped_oak_log' }] }));
  assert.equal(at(1, 1, 4), 'air');
  assert.equal(at(1, 1, 3), 'glass_pane');
  assert.equal(at(2, 0, 5), 'oak_stairs[facing=north,half=top]');
  assert.equal(at(1, 3, 4), 'stripped_oak_log[axis=x]');
  assert.equal(at(3, 2, 4), 'stripped_oak_log[axis=y]');
  assert.equal(at(1, 0, 4), 'stripped_oak_log[axis=x]');
  assert.equal(cellsAt(shapeCells({ shape: 'window', from: p(4, 2, 1), to: p(4, 2, 1), block: 'glass_pane', facing: 'east', sill: 'spruce_slab' }))(5, 1, 1), 'spruce_slab[type=top]');
  assert.throws(() => shapeCells({ shape: 'window', from: p(1, 1, 4), to: p(2, 2, 5), block: 'glass_pane', facing: 'south' }), /同一面墙/);
  assert.throws(() => shapeCells({ shape: 'window', from: p(1, 1, 4), to: p(2, 2, 4), block: 'glass_pane' }), /facing/);
});

test('door: faces in with its upper half left free; a pair hinges on its outer edges; only doors, at most two wide', () => {
  const one = cellsAt(shapeCells({ shape: 'door', from: p(3, 1, 0), to: p(3, 1, 0), block: 'spruce_door', facing: 'north' }));
  assert.equal(one(3, 1, 0), 'spruce_door[facing=south,half=lower,hinge=left]');
  assert.equal(one(3, 2, 0), 'air');
  // Walking in (south) the left is east: the east door hinges left, the west one right.
  const two = cellsAt(shapeCells({ shape: 'door', from: p(3, 1, 0), to: p(4, 3, 0), block: 'oak_door', facing: 'north' }));
  assert.equal(two(4, 1, 0), 'oak_door[facing=south,half=lower,hinge=left]');
  assert.equal(two(3, 1, 0), 'oak_door[facing=south,half=lower,hinge=right]');
  assert.equal(two(3, 3, 0), 'air', 'a taller doorway stays open above the doors');
  // Facing west the door faces east going in: its left is north.
  assert.equal(cellsAt(shapeCells({ shape: 'door', from: p(0, 1, 3), to: p(0, 1, 4), block: 'oak_door', facing: 'west' }))(0, 1, 3), 'oak_door[facing=east,half=lower,hinge=left]');
  assert.throws(() => shapeCells({ shape: 'door', from: p(3, 1, 0), to: p(3, 1, 0), block: 'oak_planks', facing: 'north' }), /要写门/);
  assert.throws(() => shapeCells({ shape: 'door', from: p(3, 1, 0), to: p(5, 1, 0), block: 'oak_door', facing: 'north' }), /两格宽/);
});

test('stairs: a step up per block forward, headroom cleared above every step, support fills underneath; the slope has to be one', () => {
  const at = cellsAt(resolveCells({ shapes: [{ shape: 'fill', from: p(0, 5, 0), to: p(5, 5, 1), block: 'oak_planks' }, { shape: 'stairs', from: p(0, 1, 0), to: p(3, 4, 1), block: 'oak_stairs', facing: 'east', support: 'cobblestone' }] }));
  assert.equal(at(0, 1, 0), 'oak_stairs[facing=east,half=bottom]');
  assert.equal(at(3, 4, 1), 'oak_stairs[facing=east,half=bottom]');
  assert.equal(at(2, 1, 0), 'cobblestone');
  assert.equal(at(1, 4, 0), 'air', 'the floor above is opened over the stairs');
  assert.equal(at(5, 5, 0), 'oak_planks', 'the floor past the top step stays');
  const north = cellsAt(shapeCells({ shape: 'stairs', from: p(0, 1, 0), to: p(0, 3, 2), block: 'stone_brick_stairs', facing: 'north' }));
  assert.equal(north(0, 1, 2), 'stone_brick_stairs[facing=north,half=bottom]');
  assert.equal(north(0, 3, 0), 'stone_brick_stairs[facing=north,half=bottom]');
  assert.throws(() => shapeCells({ shape: 'stairs', from: p(0, 1, 0), to: p(3, 2, 0), block: 'oak_stairs', facing: 'east' }), /每往前一格升一格/);
});

test('roof: hip steps in on all four sides; pitch 0.5 lays slabs half a block a row; the block has to fit the pitch', () => {
  const hip = cellsAt(roofCells({ shape: 'roof', from: p(0, 5, 0), to: p(4, 5, 4), block: 'oak_stairs', style: 'hip' }));
  assert.equal(hip(2, 5, 0), 'oak_stairs[facing=south,half=bottom]');
  assert.equal(hip(0, 5, 2), 'oak_stairs[facing=east,half=bottom]');
  assert.equal(hip(4, 5, 2), 'oak_stairs[facing=west,half=bottom]');
  assert.equal(hip(2, 6, 1), 'oak_stairs[facing=south,half=bottom]');
  assert.equal(hip(2, 7, 2), 'oak_slab[type=bottom]');
  assert.ok(!roofCells({ shape: 'roof', from: p(0, 5, 0), to: p(4, 5, 4), block: 'oak_stairs', style: 'hip' }).some(c => c.state === 'oak_planks'), 'no gable ends');
  const low = cellsAt(roofCells({ shape: 'roof', from: p(0, 5, 0), to: p(6, 5, 4), block: 'deepslate_tile_slab', pitch: 0.5 }));
  assert.equal(low(3, 5, 0), 'deepslate_tile_slab[type=bottom]');
  assert.equal(low(3, 5, 1), 'deepslate_tile_slab[type=top]');
  assert.equal(low(3, 6, 2), 'deepslate_tile_slab[type=bottom]');
  assert.equal(low(0, 5, 2), 'deepslate_tiles', 'the gable end fills up under the ridge');
  assert.equal(cellsAt(roofCells({ shape: 'roof', from: p(0, 5, 0), to: p(4, 5, 4), block: 'oak_stairs', pitch: 0.5, style: 'hip' }))(1, 5, 1), 'oak_slab[type=top]');
  assert.throws(() => roofCells({ shape: 'roof', from: p(0, 0, 0), to: p(2, 0, 2), block: 'oak_slab' }), /pitch: 0\.5/);
  assert.throws(() => roofCells({ shape: 'roof', from: p(0, 0, 0), to: p(2, 0, 2), block: 'oak_planks', pitch: 0.5 }), /楼梯或台阶/);
});

test('edit: replace keeps the properties the new block has, within a box only; remove boxes; set cells', () => {
  const blueprint = { version: 1, name: 'a', description: '', size: p(3, 2, 1), createdAt: '', source: '', blocks: [[0, 0, 0, 'oak_stairs[facing=east,half=top]'], [1, 0, 0, 'oak_stairs[facing=west,half=bottom]'], [2, 0, 0, 'oak_planks'], [2, 1, 0, 'oak_planks']] };
  const swapped = editBlueprint(blueprint, { replace: [{ from: 'oak_stairs', to: 'spruce_stairs' }, { from: 'oak_planks', to: 'stone' }], within: { from: p(0, 0, 0), to: p(2, 0, 0) } }, blockProperties);
  const at = cellsAt(swapped.cells);
  assert.equal(at(0, 0, 0), 'spruce_stairs[facing=east,half=top]');
  assert.equal(at(2, 0, 0), 'stone');
  assert.equal(at(2, 1, 0), 'oak_planks', 'outside within');
  assert.deepEqual(swapped.replaced, [['oak_stairs → spruce_stairs', 2], ['oak_planks → stone', 1]]);
  assert.equal(cellsAt(editBlueprint(blueprint, { replace: [{ from: 'oak_stairs[half=top]', to: 'stone_bricks' }] }, blockProperties).cells)(0, 0, 0), 'stone_bricks', 'facing and half do not carry to a full block');
  const cut = editBlueprint(blueprint, { remove: [{ from: p(2, 0, 0), to: p(2, 1, 0) }], set: [{ x: 0, y: 1, z: 0, block: 'lantern' }] }, blockProperties);
  assert.equal(cut.removed, 2);
  assert.equal(cellsAt(cut.cells)(0, 1, 0), 'lantern');
  assert.throws(() => editBlueprint(blueprint, { remove: [{ from: p(0, 0, 0), to: p(9, 9, 9) }] }, blockProperties), /一格都不剩/);
});

test('render: a PNG with two views and floor plans, and the plans as text (door, windows, walls) for models without pictures', () => {
  const cells = exampleCells();
  const voxels = voxelsOf(cells);
  assert.deepEqual(detectFloors(voxels).slice(0, 1), [0]);
  // Rows start at the smallest z, the eaves and the step outside the door at z=-1.
  const plan = textPlan(voxels, 0);
  assert.equal(plan[1][6], 'D', 'the door in the north wall');
  assert.equal(plan[1][0], '#');
  assert.equal(plan[8].slice(1, 4), 'WWW', 'the recessed windows, one in from the south wall');
  const drawn = renderVoxels(voxels);
  assert.deepEqual([...drawn.png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.match(drawn.caption, /第 1 层文字平面图（地板 y=0/);
  assert.ok(renderVoxels([{ x: 0, y: 0, z: 0, name: 'somemod:machine', props: {} }]).png.length > 0, 'a block it does not know is drawn as a plain cube');
  assert.deepEqual(blockProperties('oak_stairs').sort(), ['facing', 'half', 'shape', 'waterlogged']);
  assert.equal(blockProperties('somemod:machine'), undefined);
});

test('guide: the general notes and the list of styles, or one style; its example house is a valid design', () => {
  assert.match(designGuide(), /## 零件/);
  assert.match(designGuide(), /风格（guide 带 topic 看）：日式、/);
  assert.match(designGuide('日式'), /## 风格：日式/);
  assert.throws(() => designGuide('哥特'), /没有「哥特」/);
  const at = cellsAt(exampleCells());
  assert.equal(at(6, 1, 0), 'spruce_door[facing=south,half=lower,hinge=left]');
  assert.equal(at(4, 2, 0), 'spruce_log[axis=y]');
  assert.equal(at(6, 10, 4), 'dark_oak_slab[type=bottom]', 'the ridge');
});

async function setup(t) {
  const mock = await mockServerControl(); t.after(() => mock.close());
  const hello = mock.handlers.hello;
  mock.handlers.hello = () => ({ ...hello(), capabilities: [...serverCapabilities, 'build'] });
  const body = await ServerBody.connect({ connection: mock.connection, username: 'ServerBot', worldId: 'test-world', heartbeatIntervalMs: 60000 });
  t.after(() => body.close());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blueprints-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const shelf = new BlueprintShelf(dir);
  const server = createMcpServer(body, new EventJournal(), { blueprints: shelf });
  const [left, right] = InMemoryTransport.createLinkedPair(), c = new Client({ name: 'design-test', version: '1' });
  await server.connect(left); await c.connect(right); t.after(async () => { await c.close(); await server.close(); });
  const call = async args => { const r = await c.callTool({ name: 'blueprints', arguments: args }); return r; };
  return { call, shelf, mock };
}

test('blueprints tool: guide, save with a palette, render a draft or a saved one (picture, or text only), edit to a new name', async t => {
  const { call, shelf, mock } = await setup(t);
  assert.match((await call({ action: 'guide' })).content[0].text, /## 流程/);
  const design = guideExample();
  assert.deepEqual(JSON.parse((await call({ action: 'save', name: '木屋', ...design })).content[0].text).size, { x: 13, y: 11, z: 11 });
  const drawn = await call({ action: 'render', name: '木屋' });
  assert.equal(drawn.content[0].type, 'image');
  assert.equal(drawn.content[0].mimeType, 'image/png');
  assert.match(drawn.content[1].text, /蓝图「木屋」，13×11×11（x×y×z）/);
  const text = await call({ action: 'render', shapes: design.shapes, palette: design.palette, image: false });
  assert.equal(text.content.length, 1);
  assert.match(text.content[0].text, /草稿.*\n.*\n.*文字平面图/s);
  assert.match((await call({ action: 'render', name: '木屋', shapes: design.shapes })).content[0].text, /只给一种/);
  const edited = JSON.parse((await call({ action: 'edit', name: '木屋', saveAs: '石木屋', palette: { wall: 'stone_bricks' }, replace: [{ from: 'oak_planks', to: '@wall' }, { from: 'dark_oak_stairs', to: 'spruce_stairs' }] })).content[0].text);
  assert.equal(edited.replaced['oak_planks → stone_bricks'] > 0, true);
  assert.ok(shelf.load('石木屋').blocks.some(b => b[3] === 'spruce_stairs[facing=south,half=bottom]'));
  assert.equal(shelf.load('石木屋').source, '由「木屋」改出来（build tool）');
  assert.match((await call({ action: 'edit', name: '木屋', set: [{ x: 0, y: 0, z: 0, block: 'stone' }] })).content[0].text, /saveAs/);
  assert.equal(mock.calls.filter(c => c.method === 'act').length, 0, 'designing never moves the body');
});
