import fs from 'node:fs';
import path from 'node:path';
import { BodyError, type Position } from './body.js';

/**
 * Blueprints and shapes for `build`. A blueprint is a JSON file (the private repo's design format, version 1):
 * blocks are [x, y, z, "block[state]"] relative to the minimum corner, names with or without "minecraft:".
 * They live in one directory (default <runtime>/blueprints, or --blueprint-dir). Everything here only turns designs
 * into absolute cells; the server parses the states, turns them with the game's own rotation and places them.
 * Parts (box, window, door, stairs, hip and half-pitch roofs) and the palette of materials by role are the design
 * language of docs/building_design.md: a model describes a house in a few dozen lines instead of every cell.
 */
export interface Blueprint {
  version: 1; name: string; description: string; size: Position;
  blocks: [number, number, number, string][]; createdAt: string; source: string;
}
export interface Cell { x: number; y: number; z: number; state: string; rotation?: Rotation }
export type Rotation = 0 | 90 | 180 | 270;
export type Facing = 'north' | 'south' | 'east' | 'west';
export type ShapeKind = 'fill' | 'hollow' | 'walls' | 'line' | 'roof' | 'box' | 'window' | 'door' | 'stairs';
export interface Shape {
  shape: ShapeKind; from: Position; to: Position; block: string;
  ridge?: 'x' | 'z'; ridgeBlock?: string; gableBlock?: string; style?: 'gable' | 'hip'; pitch?: 1 | 0.5; rings?: number;
  frame?: string; floor?: string; ceiling?: string; pillarEvery?: number;
  facing?: Facing; recess?: boolean; sill?: string; trim?: string; hinge?: 'left' | 'right'; support?: string;
}
/** Materials by role ("wall": "white_terracotta"), written as "@wall" or "@wall[props]" wherever a block goes. */
export type Palette = Record<string, string>;

export const MAX_CELLS = 4096;
const NAME = /^[\p{L}\p{N}_-]{1,40}$/u;
const STATE = /^(?:[a-z0-9_.-]+:)?[a-z0-9_./-]+(?:\[[a-z0-9_]+=[a-z0-9_]+(?:,[a-z0-9_]+=[a-z0-9_]+)*\])?$/;
export const validState = (text: string) => STATE.test(text);

/** "minecraft:oak_stairs[facing=east]" → { name: "oak_stairs", props: { facing: "east" } }, and back. */
export function parseState(text: string): { name: string; props: Record<string, string> } {
  const m = /^(?:minecraft:)?([^[\]]+)(?:\[(.*)\])?$/.exec(text.trim());
  if (!m) return { name: text, props: {} };
  const props: Record<string, string> = {};
  for (const pair of (m[2] ?? '').split(',').filter(Boolean)) { const [k, v] = pair.split('='); if (k && v !== undefined) props[k.trim()] = v.trim(); }
  return { name: m[1].trim(), props };
}
export function formatState(name: string, props: Record<string, string>): string {
  const pairs = Object.entries(props).map(([k, v]) => `${k}=${v}`);
  return pairs.length ? `${name}[${pairs.join(',')}]` : name;
}
/** The state with these properties added where it does not set them already. */
const withDefaults = (state: string, props: Record<string, string>) => { const s = parseState(state); return formatState(s.name, { ...props, ...s.props }); };

const ROLE = /^@([a-z][a-z0-9_]{0,19})(?:\[(.*)\])?$/;
export function fromPalette(text: string, palette: Palette | undefined): string {
  const m = ROLE.exec(text);
  if (!m) return text;
  const base = palette?.[m[1]];
  if (base === undefined) throw new BodyError('INVALID_ARGUMENT', `palette 里没有 @${m[1]}（有：${Object.keys(palette ?? {}).map(k => `@${k}`).join('、') || '没有给 palette'}）`);
  if (base.startsWith('@')) throw new BodyError('INVALID_ARGUMENT', `palette 的 ${m[1]} 要写方块，不能再引用 ${base}`);
  return m[2] ? formatState(parseState(base).name, { ...parseState(base).props, ...parseState(`x[${m[2]}]`).props }) : base;
}
const ROLE_FIELDS = ['block', 'ridgeBlock', 'gableBlock', 'frame', 'floor', 'ceiling', 'sill', 'trim', 'support'] as const;
const resolveShape = (s: Shape, palette: Palette | undefined): Shape => {
  const out = { ...s };
  for (const field of ROLE_FIELDS) if (typeof out[field] === 'string') out[field] = fromPalette(out[field] as string, palette);
  return out;
};

/** Blocks that lie along an axis (logs, wood, pillars...): parts set the axis from the way they run unless the state has one. */
const AXIS_BLOCK = /(_log|_wood|_stem|_hyphae|_pillar|^basalt|^polished_basalt|^bone_block|^hay_block|bamboo_block|^chain|^deepslate|^muddy_mangrove_roots|_froglight)$/;
export function along(state: string, axis: 'x' | 'y' | 'z'): string {
  const s = parseState(state);
  return AXIS_BLOCK.test(s.name) && !s.props.axis ? formatState(s.name, { ...s.props, axis }) : state;
}

const floor = (p: Position) => ({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) });
function box(from: Position, to: Position) {
  const a = floor(from), b = floor(to);
  return { x1: Math.min(a.x, b.x), x2: Math.max(a.x, b.x), y1: Math.min(a.y, b.y), y2: Math.max(a.y, b.y), z1: Math.min(a.z, b.z), z2: Math.max(a.z, b.z) };
}
/** A part that would make more cells than one build takes is refused before it is made. */
function tooMany(count: number, what: string) {
  if (count > MAX_CELLS) throw new BodyError('INVALID_ARGUMENT', `${what}太大：约 ${count} 格，一次最多 ${MAX_CELLS} 格`);
}

const STEP: Record<Facing, { x: number; z: number }> = { north: { x: 0, z: -1 }, south: { x: 0, z: 1 }, east: { x: 1, z: 0 }, west: { x: -1, z: 0 } };
const OPPOSITE: Record<Facing, Facing> = { north: 'south', south: 'north', east: 'west', west: 'east' };
const LEFT_OF: Record<Facing, Facing> = { north: 'west', west: 'south', south: 'east', east: 'north' };
const need = <T>(value: T | undefined, what: string): T => { if (value === undefined) throw new BodyError('INVALID_ARGUMENT', what); return value; };

/** Turn a point of a blueprint of this size clockwise seen from above (north becomes east, as the game's Rotation). */
export function rotatePos(p: Position, rotation: Rotation, size: Position): Position {
  switch (rotation) {
    case 90: return { x: size.z - 1 - p.z, y: p.y, z: p.x };
    case 180: return { x: size.x - 1 - p.x, y: p.y, z: size.z - 1 - p.z };
    case 270: return { x: p.z, y: p.y, z: size.x - 1 - p.x };
    default: return { ...p };
  }
}
export const rotatedSize = (size: Position, rotation: Rotation): Position => rotation === 90 || rotation === 270 ? { x: size.z, y: size.y, z: size.x } : { ...size };

/** Stairs or slab name → the slab and the full block of the same material (oak_stairs → oak_slab, oak_planks). */
const WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'bamboo', 'crimson', 'warped'];
export function roofMaterials(block: string): { slab: string; full: string } {
  const namespace = block.includes(':') ? block.slice(0, block.indexOf(':') + 1) : '';
  const base = block.slice(namespace.length).replace(/\[.*$/, '').replace(/_(stairs|slab)$/, '');
  const full = WOODS.includes(base) ? `${base}_planks` : /(brick|tile)$/.test(base) ? `${base}s` : base === 'quartz' || base === 'purpur' ? `${base}_block` : base;
  return { slab: `${namespace}${base}_slab`, full: `${namespace}${full}` };
}

/**
 * Roofs. from/to is the bottom layer (one wider than the walls makes eaves). Gable (default): the two long sides step
 * in and up towards the ridge, the triangle ends get gableBlock (default the full block; "none" leaves them open).
 * Hip: all four sides step in, no gable ends. Pitch 1 (default) uses stairs facing the ridge, rising one block a row;
 * pitch 0.5 uses slabs, bottom then top, rising half a block a row. An odd middle row or the last line gets ridgeBlock
 * (default the slab that comes next). trim (stairs, or a slab at pitch 0.5) edges the roof in another material: the eave
 * rows and the two gable edges, or on a hip roof the eaves and the four hip lines. rings lays only that many outer rings
 * (no ridge, no gable ends): an eave skirt between two floors or under a steeper roof.
 */
export function roofCells(s: Shape): Cell[] {
  const { x1, x2, y1, z1, z2 } = box(s.from, s.to);
  tooMany((x2 - x1 + 1) * (z2 - z1 + 1), 'roof ');
  const name = s.block.replace(/\[.*$/, ''), pitch = s.pitch ?? 1;
  if (pitch === 1 && !/_stairs$/.test(name)) throw new BodyError('INVALID_ARGUMENT', `roof 的 block 要写楼梯，比如 oak_stairs（现在是 ${s.block}）；用台阶要加 pitch: 0.5`);
  if (pitch === 0.5 && !/_(stairs|slab)$/.test(name)) throw new BodyError('INVALID_ARGUMENT', `pitch 0.5 的 roof 要写楼梯或台阶，比如 oak_slab（现在是 ${s.block}）`);
  const material = roofMaterials(name);
  const edge = s.trim?.replace(/\[.*$/, '');
  if (edge && pitch === 1 && !/_stairs$/.test(edge)) throw new BodyError('INVALID_ARGUMENT', `roof 的 trim 要写楼梯，比如 stone_brick_stairs（现在是 ${s.trim}）`);
  if (edge && pitch === 0.5 && !/_(stairs|slab)$/.test(edge)) throw new BodyError('INVALID_ARGUMENT', `pitch 0.5 的 roof 的 trim 要写楼梯或台阶（现在是 ${s.trim}）`);
  // Ring k: how high and in what state its cells go; f is the side they face (towards the ridge); trimmed cells take the trim material.
  const rise = (k: number) => pitch === 1 ? k : Math.floor(k / 2);
  const slabOf = (base: string, k: number) => `${roofMaterials(base).slab}[type=${k % 2 ? 'top' : 'bottom'}]`;
  const surface = (k: number, f: Facing, trimmed = false) => {
    const stairs = trimmed && edge ? edge : name;
    return pitch === 1 ? `${stairs}[facing=${f},half=bottom]` : slabOf(stairs, k);
  };
  const top = (k: number, trimmed = false) => !s.ridgeBlock && trimmed && edge ? (pitch === 1 ? `${roofMaterials(edge).slab}[type=bottom]` : slabOf(edge, k))
    : s.ridgeBlock ?? (pitch === 1 ? `${material.slab}[type=bottom]` : slabOf(name, k));
  const out: Cell[] = [];
  const more = (k: number) => s.rings === undefined || k < s.rings;
  if (s.style === 'hip') {
    for (let k = 0; more(k); k++) {
      const xa = x1 + k, xb = x2 - k, za = z1 + k, zb = z2 - k, y = y1 + rise(k);
      if (xa > xb || za > zb) break;
      if (xa === xb || za === zb) { for (let x = xa; x <= xb; x++) for (let z = za; z <= zb; z++) out.push({ x, y, z, state: top(k, (x === xa || x === xb) && (z === za || z === zb)) }); break; }
      for (let x = xa; x <= xb; x++) {
        const trimmed = k === 0 || x === xa || x === xb;
        out.push({ x, y, z: za, state: surface(k, 'south', trimmed) }); out.push({ x, y, z: zb, state: surface(k, 'north', trimmed) });
      }
      for (let z = za + 1; z < zb; z++) { out.push({ x: xa, y, z, state: surface(k, 'east', k === 0) }); out.push({ x: xb, y, z, state: surface(k, 'west', k === 0) }); }
    }
    return out;
  }
  const gable = s.gableBlock === 'none' || s.rings !== undefined ? null : s.gableBlock ?? material.full;
  const ridge = s.ridge ?? (x2 - x1 >= z2 - z1 ? 'x' : 'z');
  const at = (a: number, y: number, b: number, state: string): Cell => ridge === 'x' ? { x: a, y, z: b, state } : { x: b, y, z: a, state };
  const [a1, a2, b1, b2] = ridge === 'x' ? [x1, x2, z1, z2] : [z1, z2, x1, x2];
  const [low, high]: Facing[] = ridge === 'x' ? ['south', 'north'] : ['east', 'west'];
  const height = new Map<number, number>();
  for (let k = 0; more(k); k++) {
    const bl = b1 + k, br = b2 - k, y = y1 + rise(k);
    if (bl > br) break;
    if (bl === br) { for (let a = a1; a <= a2; a++) out.push(at(a, y, bl, top(k, a === a1 || a === a2))); height.set(bl, y); break; }
    for (let a = a1; a <= a2; a++) {
      const trimmed = k === 0 || a === a1 || a === a2;
      out.push(at(a, y, bl, surface(k, low, trimmed))); out.push(at(a, y, br, surface(k, high, trimmed)));
    }
    height.set(bl, y); height.set(br, y);
  }
  // The triangle ends: under the roof at both ends, up to the layer below each row's roof cell.
  if (gable) for (const [b, y] of height) for (let yy = y1; yy < y; yy++) { out.push(at(a1, yy, b, gable)); if (a2 !== a1) out.push(at(a2, yy, b, gable)); }
  return out;
}

/** A building block: walls round the sides, optional floor and ceiling inside, optional frame posts and beams. */
function boxCells(s: Shape): Cell[] {
  const { x1, x2, y1, y2, z1, z2 } = box(s.from, s.to);
  tooMany(2 * (x2 - x1 + z2 - z1 + 2) * (y2 - y1 + 1) + 2 * (x2 - x1 + 1) * (z2 - z1 + 1), 'box ');
  const out: Cell[] = [];
  for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++) if (x === x1 || x === x2 || z === z1 || z === z2) out.push({ x, y, z, state: s.block });
  for (const [y, state] of [[y1, s.floor], [y2, s.ceiling]] as const) if (state) for (let x = x1 + 1; x < x2; x++) for (let z = z1 + 1; z < z2; z++) out.push({ x, y, z, state });
  if (s.frame) {
    // Beams round the bottom and the top, lying along their side; posts at the corners and every pillarEvery blocks, upright.
    for (const y of y2 > y1 ? [y1, y2] : [y1]) {
      for (let x = x1; x <= x2; x++) for (const z of [z1, z2]) out.push({ x, y, z, state: along(s.frame, 'x') });
      for (let z = z1; z <= z2; z++) for (const x of [x1, x2]) out.push({ x, y, z, state: along(s.frame, 'z') });
    }
    const every = s.pillarEvery;
    const stops = (a: number, b: number) => { const at = new Set([a, b]); if (every && every > 0) for (let v = a; v < b; v += every) at.add(v); return [...at]; };
    const posts = new Set<string>();
    for (const x of stops(x1, x2)) for (const z of [z1, z2]) posts.add(`${x},${z}`);
    for (const z of stops(z1, z2)) for (const x of [x1, x2]) posts.add(`${x},${z}`);
    for (const p of posts) { const [x, z] = p.split(',').map(Number); for (let y = y1; y <= y2; y++) out.push({ x, y, z, state: along(s.frame, 'y') }); }
  }
  return out;
}

/** An opening in a wall: from/to on one wall plane (at least minHeight high), facing the outside. u runs along the wall. */
function opening(s: Shape, what: string, minHeight = 1) {
  const facing = need(s.facing, `${what} 要给 facing（朝外的方向）`);
  const { x1, x2, y1, y2: top, z1, z2 } = box(s.from, s.to);
  const y2 = Math.max(top, y1 + minHeight - 1);
  const alongX = facing === 'north' || facing === 'south';
  if (alongX ? z1 !== z2 : x1 !== x2) throw new BodyError('INVALID_ARGUMENT', `${what} 的 from/to 要在同一面墙上：朝 ${facing} 的${alongX ? ' z' : ' x'} 要相同`);
  tooMany((alongX ? x2 - x1 + 3 : z2 - z1 + 3) * (y2 - y1 + 3) * 2, `${what} `);
  const [u1, u2] = alongX ? [x1, x2] : [z1, z2];
  /** out: how many blocks outward (negative: inward) of the wall plane. */
  const cell = (u: number, y: number, state: string, out = 0): Cell => {
    const step = STEP[facing];
    return alongX ? { x: u, y, z: z1 + step.z * out, state } : { x: x1 + step.x * out, y, z: u, state };
  };
  const ring = (trim: string, withBottom: boolean): Cell[] => {
    const out: Cell[] = [], beam = along(trim, alongX ? 'x' : 'z'), post = along(trim, 'y');
    for (let u = u1 - 1; u <= u2 + 1; u++) { out.push(cell(u, y2 + 1, beam)); if (withBottom) out.push(cell(u, y1 - 1, beam)); }
    for (let y = withBottom ? y1 - 1 : y1; y <= y2 + 1; y++) for (const u of [u1 - 1, u2 + 1]) out.push(cell(u, y, post));
    return out;
  };
  return { inward: OPPOSITE[facing], u1, u2, y1, y2, cell, ring, alongX };
}

/** Glass in a wall opening; recess sets it one block in (the opening left open), sill goes under it outside, trim round it. */
function windowCells(s: Shape): Cell[] {
  const o = opening(s, 'window');
  const out: Cell[] = s.trim ? o.ring(s.trim, true) : [];
  for (let u = o.u1; u <= o.u2; u++) for (let y = o.y1; y <= o.y2; y++) {
    if (s.recess) out.push(o.cell(u, y, 'air'), o.cell(u, y, s.block, -1)); else out.push(o.cell(u, y, s.block));
  }
  if (s.sill) {
    // An upside-down stair leans its back on the wall; a slab sits in the top half.
    const name = parseState(s.sill).name;
    const sill = /_stairs$/.test(name) ? withDefaults(s.sill, { facing: o.inward, half: 'top' }) : /_slab$/.test(name) ? withDefaults(s.sill, { type: 'top' }) : s.sill;
    for (let u = o.u1; u <= o.u2; u++) out.push(o.cell(u, o.y1 - 1, sill, 1));
  }
  return out;
}

/** A doorway one or two wide: doors in the bottom row (a pair hinges on the outside edges), open above them. */
function doorCells(s: Shape): Cell[] {
  const o = opening(s, 'door', 2);
  const name = parseState(s.block).name;
  if (!/_door$/.test(name)) throw new BodyError('INVALID_ARGUMENT', `door 的 block 要写门，比如 spruce_door（现在是 ${s.block}）`);
  if (o.u2 - o.u1 > 1) throw new BodyError('INVALID_ARGUMENT', 'door 最多两格宽（双开门）');
  // The door faces in (it is placed from outside); its left is the left seen walking in, where hinge=left puts the hinge.
  const leftward = STEP[LEFT_OF[o.inward]], leftU = o.alongX ? leftward.x : leftward.z;
  const out: Cell[] = s.trim ? o.ring(s.trim, false) : [];
  for (let u = o.u1; u <= o.u2; u++) {
    const hinge = o.u1 === o.u2 ? s.hinge ?? 'left' : (u === o.u1) === (leftU < 0) ? 'left' : 'right';
    out.push(o.cell(u, o.y1, withDefaults(s.block, { facing: o.inward, half: 'lower', hinge })));
    // The upper half comes with the door (the server takes "air" there as room for it); higher rows stay open.
    for (let y = o.y1 + 1; y <= o.y2; y++) out.push(o.cell(u, y, 'air'));
  }
  return out;
}

/**
 * A staircase going up towards facing, one block a row, with three blocks of headroom kept clear above every step: stepping up,
 * the body is still half over the step below with its head a block higher (10-16 with two, a player hit the edge of the floor above).
 */
function stairCells(s: Shape): Cell[] {
  const facing = need(s.facing, 'stairs 要给 facing（往上走的方向）');
  const { x1, x2, y1, y2, z1, z2 } = box(s.from, s.to);
  const alongX = facing === 'east' || facing === 'west';
  const run = alongX ? x2 - x1 : z2 - z1;
  if (run !== y2 - y1) throw new BodyError('INVALID_ARGUMENT', `stairs 每往前一格升一格：朝 ${facing} 走了 ${run + 1} 格，就要升 ${run + 1} 层（现在 y 从 ${y1} 到 ${y2}）`);
  const [w1, w2] = alongX ? [z1, z2] : [x1, x2];
  tooMany((run + 1) * (w2 - w1 + 1) * (s.support ? run + 5 : 4), 'stairs ');
  const forward = STEP[facing].x + STEP[facing].z > 0;
  const step = withDefaults(s.block, { facing, half: 'bottom' });
  const out: Cell[] = [];
  for (let i = 0; i <= run; i++) {
    const a = alongX ? (forward ? x1 + i : x2 - i) : (forward ? z1 + i : z2 - i), y = y1 + i;
    for (let w = w1; w <= w2; w++) {
      const at = (yy: number, state: string): Cell => alongX ? { x: a, y: yy, z: w, state } : { x: w, y: yy, z: a, state };
      if (s.support) for (let yy = y1; yy < y; yy++) out.push(at(yy, s.support));
      out.push(at(y, step), at(y + 1, 'air'), at(y + 2, 'air'), at(y + 3, 'air'));
    }
  }
  return out;
}

export function shapeCells(s: Shape): Cell[] {
  const { x1, x2, y1, y2, z1, z2 } = box(s.from, s.to);
  switch (s.shape) {
    case 'roof': return roofCells(s);
    case 'box': return boxCells(s);
    case 'window': return windowCells(s);
    case 'door': return doorCells(s);
    case 'stairs': return stairCells(s);
    case 'line': {
      const a = floor(s.from), b = floor(s.to), d = { x: Math.abs(b.x - a.x), y: Math.abs(b.y - a.y), z: Math.abs(b.z - a.z) }, n = Math.max(d.x, d.y, d.z);
      tooMany(n + 1, 'line ');
      // Logs and pillars along a line lie the way it runs.
      const state = n === 0 ? s.block : along(s.block, d.x === n ? 'x' : d.z === n ? 'z' : 'y');
      return Array.from({ length: n + 1 }, (_, i) => { const t = n ? i / n : 0; return { x: Math.round(a.x + (b.x - a.x) * t), y: Math.round(a.y + (b.y - a.y) * t), z: Math.round(a.z + (b.z - a.z) * t), state }; });
    }
  }
  const volume = (x2 - x1 + 1) * (y2 - y1 + 1) * (z2 - z1 + 1);
  if (volume > MAX_CELLS) throw new BodyError('INVALID_ARGUMENT', `区域太大：${volume} 格，一次最多 ${MAX_CELLS} 格`);
  const out: Cell[] = [];
  for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++) {
    const side = x === x1 || x === x2 || z === z1 || z === z2;
    if (s.shape === 'fill' || (s.shape === 'walls' && side) || (s.shape === 'hollow' && (side || y === y1 || y === y2))) out.push({ x, y, z, state: s.block });
  }
  return out;
}

export class BlueprintShelf {
  constructor(readonly dir: string) {}
  private file(name: string): string {
    if (!NAME.test(name)) throw new BodyError('INVALID_ARGUMENT', `蓝图名只能用字母、数字、中文、下划线和横线，最多 40 个字：${name}`);
    return path.join(this.dir, `${name}.json`);
  }
  load(name: string): Blueprint {
    let raw: string;
    try { raw = fs.readFileSync(this.file(name), 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new BodyError('NOT_FOUND', `没有叫「${name}」的蓝图（blueprints list 看有哪些）`); throw error; }
    const data = JSON.parse(raw.replace(/^﻿/, '')) as Blueprint;
    if (data?.version !== 1 || !Array.isArray(data.blocks) || !data.size) throw new BodyError('INVALID_ARGUMENT', `蓝图文件格式不对：${name}`);
    return data;
  }
  list(): Blueprint[] {
    let names: string[];
    try { names = fs.readdirSync(this.dir).filter(f => f.endsWith('.json')); } catch { return []; }
    const out: Blueprint[] = [];
    for (const f of names) { try { out.push(this.load(f.slice(0, -5))); } catch {} }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
  save(name: string, description: string, cells: Cell[], overwrite: boolean, source = 'build tool'): Blueprint {
    if (!cells.length) throw new BodyError('INVALID_ARGUMENT', '蓝图里没有方块');
    const file = this.file(name);
    if (!overwrite && fs.existsSync(file)) throw new BodyError('ALREADY_EXISTS', `已经有叫「${name}」的蓝图了；要覆盖就加 overwrite: true`);
    const min = { x: Math.min(...cells.map(c => c.x)), y: Math.min(...cells.map(c => c.y)), z: Math.min(...cells.map(c => c.z)) };
    const map = new Map<string, [number, number, number, string]>();
    for (const c of cells) { const p = [c.x - min.x, c.y - min.y, c.z - min.z] as const; map.set(p.join(','), [p[0], p[1], p[2], c.state]); }
    const blocks = [...map.values()];
    const size = { x: Math.max(...blocks.map(b => b[0])) + 1, y: Math.max(...blocks.map(b => b[1])) + 1, z: Math.max(...blocks.map(b => b[2])) + 1 };
    const blueprint: Blueprint = { version: 1, name, description, size, blocks, createdAt: new Date().toISOString(), source };
    fs.mkdirSync(this.dir, { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(blueprint) + '\n'); fs.renameSync(temporary, file);
    return blueprint;
  }
}

/** A blueprint put down with its minimum corner (after turning) at origin; each cell carries the turn for its state. */
export function placeBlueprint(blueprint: Blueprint, origin: Position, rotation: Rotation): Cell[] {
  const o = floor(origin);
  return blueprint.blocks.map(([x, y, z, state]) => {
    const p = rotatePos({ x, y, z }, rotation, blueprint.size);
    return { x: p.x + o.x, y: p.y + o.y, z: p.z + o.z, state, ...(rotation ? { rotation } : {}) };
  });
}

/** Blueprint, then shapes, then single blocks; a later cell at the same spot wins. "air" clears. "@role" comes from the palette. */
export function resolveCells(input: { blueprint?: { blueprint: Blueprint; origin: Position; rotation: Rotation }; shapes?: Shape[]; blocks?: Cell[]; palette?: Palette }): Cell[] {
  const cells = new Map<string, Cell>();
  const put = (c: Cell) => {
    if (!validState(c.state)) throw new BodyError('INVALID_ARGUMENT', `方块写法不对：${c.state}（比如 oak_stairs[facing=east,half=bottom]）`);
    const p = floor(c); cells.set(`${p.x},${p.y},${p.z}`, { ...c, ...p });
  };
  if (input.blueprint) for (const c of placeBlueprint(input.blueprint.blueprint, input.blueprint.origin, input.blueprint.rotation)) put(c);
  for (const s of input.shapes ?? []) for (const c of shapeCells(resolveShape(s, input.palette))) put(c);
  for (const c of input.blocks ?? []) put({ ...c, state: fromPalette(c.state, input.palette) });
  if (cells.size > MAX_CELLS) throw new BodyError('INVALID_ARGUMENT', `目标太多：${cells.size} 格，一次最多 ${MAX_CELLS} 格，请分批`);
  return [...cells.values()];
}

export interface BlueprintEdit {
  replace?: { from: string; to: string }[]; within?: { from: Position; to: Position };
  remove?: { from: Position; to: Position }[]; set?: { x: number; y: number; z: number; block: string }[];
}
/**
 * Changes to a saved blueprint in its own coordinates (0,0,0 the minimum corner): replace swaps materials (a bare name
 * every such block, a state only the ones it matches; facing, half and the like carry over where the new block has
 * them, as propertiesOf says), optionally only within a box; remove deletes the cells in boxes; set puts cells.
 */
export function editBlueprint(blueprint: Blueprint, edit: BlueprintEdit, propertiesOf: (name: string) => string[] | undefined): { cells: Cell[]; replaced: [string, number][]; removed: number; set: number } {
  const inside = (c: { x: number; y: number; z: number }, b: { from: Position; to: Position }) => { const r = box(b.from, b.to); return c.x >= r.x1 && c.x <= r.x2 && c.y >= r.y1 && c.y <= r.y2 && c.z >= r.z1 && c.z <= r.z2; };
  let cells: Cell[] = blueprint.blocks.map(([x, y, z, state]) => ({ x, y, z, state }));
  const replaced: [string, number][] = [];
  for (const rule of edit.replace ?? []) {
    if (!validState(rule.to)) throw new BodyError('INVALID_ARGUMENT', `方块写法不对：${rule.to}`);
    const from = parseState(rule.from), to = parseState(rule.to), keeps = propertiesOf(to.name);
    let n = 0;
    cells = cells.map(c => {
      const s = parseState(c.state);
      if (s.name !== from.name || Object.entries(from.props).some(([k, v]) => s.props[k] !== v) || (edit.within && !inside(c, edit.within))) return c;
      n++;
      const carried = Object.fromEntries(Object.entries(s.props).filter(([k]) => !keeps || keeps.includes(k)));
      return { ...c, state: formatState(to.name, { ...carried, ...to.props }) };
    });
    replaced.push([`${rule.from} → ${rule.to}`, n]);
  }
  const before = cells.length;
  for (const b of edit.remove ?? []) cells = cells.filter(c => !inside(c, b));
  const removed = before - cells.length, set = edit.set ?? [];
  const map = new Map(cells.map(c => [`${c.x},${c.y},${c.z}`, c]));
  for (const b of set) {
    if (!validState(b.block)) throw new BodyError('INVALID_ARGUMENT', `方块写法不对：${b.block}`);
    const p = floor(b); map.set(`${p.x},${p.y},${p.z}`, { ...p, state: b.block });
  }
  cells = [...map.values()];
  if (!cells.length) throw new BodyError('INVALID_ARGUMENT', '改完蓝图里一格都不剩了');
  if (cells.length > MAX_CELLS) throw new BodyError('INVALID_ARGUMENT', `改完有 ${cells.length} 格，蓝图最多 ${MAX_CELLS} 格`);
  return { cells, replaced, removed, set: set.length };
}

/** Sand, gravel, concrete powder and anvils fall into a gap below them. */
const FALLS = /(^|_)sand$|gravel$|concrete_powder$|anvil$/;
/**
 * What will not stay once built: a door whose upper half another block takes (10-16 a trial design drew a wall after its door)
 * and a block that falls with nothing under it (concrete powder over a door gap or an opening). Air over a door is its upper half.
 */
export function shakyCells(blocks: [number, number, number, string][]): string[] {
  const at = new Map(blocks.map(([x, y, z, state]) => [`${x},${y},${z}`, parseState(state)]));
  const lowest = Math.min(...blocks.map(b => b[1]));
  const door = (s?: { name: string; props: Record<string, string> }) => !!s && s.name.endsWith('_door') && s.props.half !== 'upper';
  const out: string[] = [];
  for (const [x, y, z, state] of blocks) {
    const s = parseState(state), above = at.get(`${x},${y + 1},${z}`), below = at.get(`${x},${y - 1},${z}`);
    if (door(s) && above && above.name !== 'air' && above.name !== s.name) out.push(`(${x},${y},${z}) 的门上半截被 ${above.name} 占了，门放不下`);
    if (FALLS.test(s.name) && y > lowest && (!below || below.name === 'air') && !door(at.get(`${x},${y - 2},${z}`))) out.push(`(${x},${y},${z}) 的 ${s.name} 下面是空的，会掉下来`);
  }
  return out;
}
