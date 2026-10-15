import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

/**
 * Draws a design (docs/building_design.md, "画图"): two 45° views from opposite corners and a cut-away floor plan per
 * floor, plus the same floor plans as text for models that cannot look at pictures. Ported from the old
 * mcp-server/src/vision/voxel-render.ts; instead of the texture atlas each face has its average colour, from
 * render-assets.json.gz (scripts/render-assets.mjs makes it from prismarine-viewer's 1.21.1 block models).
 */
export interface Voxel { x: number; y: number; z: number; name: string; props: Record<string, string> }
type V3 = [number, number, number];
type RawVariant = [model: number, x: number, y: number];
interface Assets {
  colors: [number, number, number, number][];
  models: [number, number, number, number, number, number, [number, number, number, number][]][][];
  blocks: Record<string, { variants?: [string, RawVariant][]; multipart?: [Record<string, unknown> | null, RawVariant][] }>;
  defaults: Record<string, Record<string, string>>;
}

let assets: Assets | undefined;
function loadAssets(): Assets {
  assets ??= JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'render-assets.json.gz'))).toString('utf8')) as Assets;
  return assets;
}

/** The properties a 1.21.1 block has (from its default state); undefined for a block it does not know (a mod's). */
export function blockProperties(name: string): string[] | undefined {
  const { blocks, defaults } = loadAssets();
  return blocks[name] ? Object.keys(defaults[name] ?? {}) : undefined;
}

const DIRS = ['down', 'up', 'north', 'south', 'west', 'east'];
const DIR_VEC: Record<string, V3> = { north: [0, 0, -1], south: [0, 0, 1], east: [1, 0, 0], west: [-1, 0, 0], up: [0, 1, 0], down: [0, -1, 0] };
const NOT_FULL = /(glass|leaves|ice$|slime|honey_block|spawner|barrier|_stairs|_slab|_pane|iron_bars|fence|_wall$|door|trapdoor|carpet|lantern|torch|bed$|flower|sapling|grass$|fern|vine|rail|button|lever|plate|sign|banner|chain|campfire|candle|pot$|head$|skull$|bars$|scaffolding|snow$|path|farmland|cake|ladder|lectern|table$|stonecutter|grindstone|bell|anvil|hopper|cauldron|composter|brewing|enchanting|end_rod|lightning_rod|amethyst_cluster|_bud$|coral|kelp|seagrass|water|lava|air)/;
const isFull = (v: Voxel | undefined) => !!v && !NOT_FULL.test(v.name);
const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

function whenMatches(when: Record<string, unknown> | null, props: Record<string, string>): boolean {
  if (!when) return true;
  if (Array.isArray(when.OR)) return (when.OR as Record<string, unknown>[]).some(w => whenMatches(w, props));
  if (Array.isArray(when.AND)) return (when.AND as Record<string, unknown>[]).every(w => whenMatches(w, props));
  return Object.entries(when).every(([k, v]) => String(v).split('|').includes(props[k] ?? ''));
}
function variantsFor(name: string, props: Record<string, string>): RawVariant[] | undefined {
  const def = loadAssets().blocks[name];
  if (!def) return undefined;
  if (def.variants) {
    const found = def.variants.find(([k]) => k === '' || k.split(',').every(pair => { const [p, v] = pair.split('='); return props[p] === v; }));
    return [(found ?? def.variants[0])[1]];
  }
  return (def.multipart ?? []).filter(([when]) => whenMatches(when, props)).map(([, v]) => v);
}

/** Turn about the block centre as block states do: x first, then y. */
function rotate(p: V3, rx: number, ry: number, centre: number): V3 {
  let [x, y, z] = [p[0] - centre, p[1] - centre, p[2] - centre];
  for (let i = 0; i < ((rx / 90) % 4 + 4) % 4; i++) [y, z] = [z, -y];
  for (let i = 0; i < ((ry / 90) % 4 + 4) % 4; i++) [x, z] = [-z, x];
  return [x + centre, y + centre, z + centre];
}
function dirName(d: V3): string {
  for (const [n, v] of Object.entries(DIR_VEC)) if (v.every((c, i) => c === Math.round(d[i]))) return n;
  return 'up';
}
/** The corners (a=0,b=0), (a=1,b=0), (a=0,b=1) of a face, a across and b down as seen from outside. */
function faceCorners(dir: string, f: V3, t: V3): [V3, V3, V3] {
  switch (dir) {
    case 'north': return [[t[0], t[1], f[2]], [f[0], t[1], f[2]], [t[0], f[1], f[2]]];
    case 'south': return [[f[0], t[1], t[2]], [t[0], t[1], t[2]], [f[0], f[1], t[2]]];
    case 'east': return [[t[0], t[1], t[2]], [t[0], t[1], f[2]], [t[0], f[1], t[2]]];
    case 'west': return [[f[0], t[1], f[2]], [f[0], t[1], t[2]], [f[0], f[1], f[2]]];
    case 'up': return [[f[0], t[1], f[2]], [t[0], t[1], f[2]], [f[0], t[1], t[2]]];
    default: return [[f[0], f[1], t[2]], [t[0], f[1], t[2]], [f[0], f[1], f[2]]];
  }
}
const SHADE: Record<string, number> = { up: 1, down: 0.5, north: 0.8, south: 0.8, east: 0.62, west: 0.62 };
function tint(name: string): V3 {
  if (/birch_leaves/.test(name)) return [128, 167, 85];
  if (/spruce_leaves/.test(name)) return [97, 153, 97];
  if (/leaves|vine/.test(name)) return [119, 171, 47];
  if (/lily_pad/.test(name)) return [32, 128, 48];
  if (/water/.test(name)) return [63, 118, 228];
  return [145, 189, 89];
}
/** Not in the 1.21.1 models (a mod block): a plain magenta cube, so it shows. */
const UNKNOWN: [number, number, number, number] = [210, 60, 210, 255];

interface Face { p0: V3; e1: V3; e2: V3; normal: V3; color: [number, number, number, number]; shade: number; edge: boolean }

const CONNECT_ALL = /(glass_pane|iron_bars)$|_pane$/, FENCE = /_fence$/, WALL = /_wall$/;
function connects(self: string, other: Voxel | undefined): boolean {
  if (!other) return false;
  if (CONNECT_ALL.test(self)) return CONNECT_ALL.test(other.name) || isFull(other) || /glass$/.test(other.name);
  if (FENCE.test(self)) return FENCE.test(other.name) || /_fence_gate$/.test(other.name) || isFull(other);
  if (WALL.test(self)) return WALL.test(other.name) || isFull(other) || /_fence_gate$/.test(other.name) || CONNECT_ALL.test(other.name);
  return false;
}

/** Doors, beds and tall plants written as one half get their other half, so the picture looks like the build. */
function withHalves(voxels: Voxel[]): Voxel[] {
  const at = new Set(voxels.map(v => key(v.x, v.y, v.z)));
  const out = [...voxels];
  for (const v of voxels) {
    let other: Voxel | undefined;
    if ((/_door$/.test(v.name) || v.props.half === 'lower') && v.props.half !== 'upper' && (/_door$/.test(v.name) || v.props.half)) other = { ...v, y: v.y + 1, props: { ...v.props, half: 'upper' } };
    else if (/_bed$/.test(v.name) && v.props.part !== 'head' && v.props.facing) { const d = DIR_VEC[v.props.facing]; other = { ...v, x: v.x + d[0], z: v.z + d[2], props: { ...v.props, part: 'head' } }; }
    if (other && !at.has(key(other.x, other.y, other.z))) out.push(other);
  }
  return out;
}

function buildFaces(voxels: Voxel[], cutY: number | null): Face[] {
  const { colors, models, defaults } = loadAssets();
  const all = withHalves(voxels);
  const map = new Map(all.map(v => [key(v.x, v.y, v.z), v]));
  const at = (x: number, y: number, z: number) => map.get(key(x, y, z));
  const faces: Face[] = [];
  for (const v of all) {
    if (cutY !== null && v.y > cutY) continue;
    const props = { ...defaults[v.name], ...v.props };
    if (CONNECT_ALL.test(v.name) || FENCE.test(v.name) || WALL.test(v.name)) {
      for (const [side, [dx, dz]] of Object.entries({ north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] })) {
        const c = connects(v.name, at(v.x + dx, v.y, v.z + dz));
        props[side] = WALL.test(v.name) ? (c ? 'low' : 'none') : String(c);
      }
      if (WALL.test(v.name)) props.up = 'true';
    }
    if (/_stairs$/.test(v.name)) props.shape = 'straight';
    const variants = variantsFor(v.name, props);
    const parts: { elements: Assets['models'][number]; rx: number; ry: number }[] = variants
      ? variants.map(([m, rx, ry]) => ({ elements: models[m], rx, ry }))
      : [{ elements: [[0, 0, 0, 16, 16, 16, DIRS.map((_, i) => [i, -1, i, 0] as [number, number, number, number])]], rx: 0, ry: 0 }];
    for (const { elements, rx, ry } of parts) for (const [fx, fy, fz, tx, ty, tz, list] of elements) {
      const from: V3 = [fx, fy, fz], to: V3 = [tx, ty, tz];
      const big = (tx - fx) * (ty - fy) + (ty - fy) * (tz - fz) >= 128;
      for (const [dirIndex, colorIndex, cullIndex, tinted] of list) {
        const dir = DIRS[dirIndex];
        const normal = rotate(DIR_VEC[dir], rx, ry, 0);
        if (cullIndex >= 0) {
          const d = rotate(DIR_VEC[DIRS[cullIndex]], rx, ry, 0);
          const next = at(v.x + d[0], v.y + d[1], v.z + d[2]);
          if (isFull(next) && (cutY === null || next!.y <= cutY)) continue;
        }
        let color = colorIndex < 0 ? UNKNOWN : colors[colorIndex];
        if (tinted && /leaves|grass|fern|vine|lily_pad|sugar_cane|water/.test(v.name)) { const t = tint(v.name); color = [color[0] * t[0] / 255, color[1] * t[1] / 255, color[2] * t[2] / 255, color[3]]; }
        if (color[3] < 16) continue;
        const [c0, c1, c2] = faceCorners(dir, from, to).map(p => rotate(p, rx, ry, 8));
        const w = (p: V3): V3 => [v.x + p[0] / 16, v.y + p[1] / 16, v.z + p[2] / 16];
        const p0 = w(c0), p1 = w(c1), p2 = w(c2);
        faces.push({ p0, e1: [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], e2: [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]], normal, color, shade: SHADE[dirName(normal)] ?? 0.8, edge: big });
      }
    }
  }
  return faces;
}

interface Camera { toCam: V3; right: V3; up: V3 }
const norm = (v: V3): V3 => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function isoCamera(fromX: number, fromZ: number): Camera {
  const toCam = norm([fromX, 0.82 * Math.SQRT2, fromZ]);
  const right = norm(cross([-toCam[0], -toCam[1], -toCam[2]], [0, 1, 0]));
  return { toCam, right, up: cross(right, [-toCam[0], -toCam[1], -toCam[2]]) };
}
const TOP: Camera = { toCam: [0, 1, 0], right: [1, 0, 0], up: [0, 0, -1] };

/** An RGB picture. */
class Picture {
  readonly data: Uint8Array;
  constructor(readonly width: number, readonly height: number, fill: V3) {
    this.data = new Uint8Array(width * height * 3);
    for (let i = 0; i < width * height; i++) this.data.set(fill, i * 3);
  }
  paste(src: Picture, ox: number, oy: number) {
    for (let y = 0; y < src.height; y++) this.data.set(src.data.subarray(y * src.width * 3, (y + 1) * src.width * 3), ((oy + y) * this.width + ox) * 3);
  }
}

/** Translucent faces (glass, panes) are drawn last, far to near, at least this opaque so they still show. */
const GLASS_MIN = 0.3;
/** Faces whose average opacity is below this (glass) are blended; above it (leaves with holes) drawn solid. */
const SOLID_ALPHA = 128;

/** Draws the faces seen by the camera, scaled to fit maxW×maxH; darkAbove darkens cut wall tops in floor plans. */
function panel(faces: Face[], cam: Camera, maxW: number, maxH: number, bg: V3, darkAbove: number | null = null): Picture {
  const seen = faces.filter(f => dot(f.normal, cam.toCam) > 1e-6);
  if (!seen.length) return new Picture(16, 16, bg);
  const across = (p: V3) => dot(p, cam.right), down = (p: V3) => -dot(p, cam.up);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const f of seen) for (const p of [f.p0, add(f.p0, f.e1), add(f.p0, f.e2), add(add(f.p0, f.e1), f.e2)]) {
    minX = Math.min(minX, across(p)); maxX = Math.max(maxX, across(p)); minY = Math.min(minY, down(p)); maxY = Math.max(maxY, down(p));
  }
  const pad = 12;
  const scale = Math.max(2, Math.min((maxW - pad * 2) / (maxX - minX || 1), (maxH - pad * 2) / (maxY - minY || 1), 40));
  const W = Math.ceil((maxX - minX) * scale) + pad * 2, H = Math.ceil((maxY - minY) * scale) + pad * 2;
  const pic = new Picture(W, H, bg), depth = new Float32Array(W * H).fill(-Infinity);
  const screen = (p: V3): [number, number] => [(across(p) - minX) * scale + pad, (down(p) - minY) * scale + pad];
  const draw = (f: Face, blend: boolean) => {
    const s0 = screen(f.p0), s1 = screen(add(f.p0, f.e1)), s2 = screen(add(f.p0, f.e2));
    const ax = s1[0] - s0[0], ay = s1[1] - s0[1], bx = s2[0] - s0[0], by = s2[1] - s0[1], det = ax * by - ay * bx;
    if (Math.abs(det) < 1e-9) return;
    const xs = [s0[0], s1[0], s2[0], s1[0] + bx], ys = [s0[1], s1[1], s2[1], s1[1] + by];
    const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(W - 1, Math.ceil(Math.max(...xs)));
    const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(H - 1, Math.ceil(Math.max(...ys)));
    const n0 = dot(f.p0, cam.toCam), n1 = dot(f.e1, cam.toCam), n2 = dot(f.e2, cam.toCam), lenA = Math.hypot(ax, ay), lenB = Math.hypot(bx, by);
    let shade = f.shade;
    if (darkAbove !== null && f.normal[1] > 0.5 && f.p0[1] >= darkAbove - 1e-6) shade *= 0.42;
    const t = blend ? Math.max(GLASS_MIN, f.color[3] / 255) : 1;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const qx = x + 0.5 - s0[0], qy = y + 0.5 - s0[1];
      const a = (qx * by - qy * bx) / det, b = (ax * qy - ay * qx) / det;
      if (a < -1e-4 || a > 1 + 1e-4 || b < -1e-4 || b > 1 + 1e-4) continue;
      const near = n0 + n1 * a + n2 * b + 1e-4, i = y * W + x;
      if (near <= depth[i]) continue;
      const sh = f.edge && (a * lenA < 0.9 || (1 - a) * lenA < 0.9 || b * lenB < 0.9 || (1 - b) * lenB < 0.9) ? shade * 0.82 : shade;
      for (let c = 0; c < 3; c++) pic.data[i * 3 + c] = Math.round(pic.data[i * 3 + c] * (1 - t) + Math.min(255, f.color[c] * sh) * t);
      if (!blend) depth[i] = near;
    }
  };
  const glass: Face[] = [];
  for (const f of seen) { if (f.color[3] >= SOLID_ALPHA) draw(f, false); else glass.push(f); }
  glass.sort((a, b) => dot(a.p0, cam.toCam) - dot(b.p0, cam.toCam)).forEach(f => draw(f, true));
  return pic;
}
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** Floors: a layer mostly of full blocks with at least two open cells above much of it (at most four are drawn). */
export function detectFloors(voxels: Voxel[]): number[] {
  if (!voxels.length) return [];
  const map = new Map(voxels.map(v => [key(v.x, v.y, v.z), v]));
  const xs = voxels.map(v => v.x), ys = voxels.map(v => v.y), zs = voxels.map(v => v.z);
  const columns: [number, number][] = [];
  for (let x = Math.min(...xs); x <= Math.max(...xs); x++) for (let z = Math.min(...zs); z <= Math.max(...zs); z++) columns.push([x, z]);
  const floors: number[] = [];
  for (let y = Math.min(...ys); y <= Math.max(...ys) - 2; y++) {
    let solid = 0, open = 0;
    for (const [x, z] of columns) {
      if (!isFull(map.get(key(x, y, z)))) continue;
      solid++;
      if (!isFull(map.get(key(x, y + 1, z))) && !isFull(map.get(key(x, y + 2, z)))) open++;
    }
    if (solid >= columns.length * 0.3 && open >= solid * 0.4) floors.push(y);
  }
  return floors.slice(0, 4);
}

/** One character per column of a floor, looking at the two cells above it. */
export const PLAN_LEGEND = '# 墙 W 窗 D 门 / 楼梯 * 其他（家具、栏杆、灯…） . 只有地板 空格 什么都没有';
export function textPlan(voxels: Voxel[], floorY: number): string[] {
  const map = new Map(voxels.map(v => [key(v.x, v.y, v.z), v]));
  const xs = voxels.map(v => v.x), zs = voxels.map(v => v.z);
  const [x1, x2, z1, z2] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const rows: string[] = [];
  for (let z = z1; z <= z2; z++) {
    let row = '';
    for (let x = x1; x <= x2; x++) {
      const above = [map.get(key(x, floorY + 1, z)), map.get(key(x, floorY + 2, z))];
      const names = above.filter((v): v is Voxel => !!v).map(v => v.name);
      row += names.some(n => /_door$/.test(n)) ? 'D' : /_stairs$/.test(names[0] ?? '') ? '/' : names.some(n => /glass|_pane$/.test(n)) ? 'W'
        : above.some(isFull) ? '#' : names.length ? '*' : map.has(key(x, floorY, z)) ? '.' : ' ';
    }
    rows.push(row.replace(/\s+$/, ''));
  }
  return rows;
}

const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
/** PNG chunks carry a CRC by format; it is written, never compared. */
function crc32(bytes: Uint8Array): number { let c = 0xffffffff; for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]), out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}
export function encodePng(pic: { width: number; height: number; data: Uint8Array }): Buffer {
  const stride = pic.width * 3 + 1, raw = Buffer.alloc(stride * pic.height);
  for (let y = 0; y < pic.height; y++) raw.set(pic.data.subarray(y * pic.width * 3, (y + 1) * pic.width * 3), y * stride + 1);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(pic.width, 0); header.writeUInt32BE(pic.height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export type Front = 'south' | 'north' | 'east' | 'west';
const SIDE_NAME: Record<Front, string> = { south: '南', north: '北', east: '东', west: '西' };
const NEAR: Record<Front, string> = { south: '西南', west: '西北', north: '东北', east: '东南' };
const FAR: Record<Front, string> = { south: '东北', west: '东南', north: '西南', east: '西北' };

/** The picture (two 45° views on top, floor plans below, north up) and its caption with the text plans. */
export function renderVoxels(voxels: Voxel[], options: { front?: Front; plans?: boolean } = {}): { png: Buffer; caption: string } {
  const bg: V3 = [232, 238, 244], front = options.front ?? 'south';
  const faces = buildFaces(voxels, null);
  const [fx, fz] = ({ south: [-1, 1], west: [-1, -1], north: [1, -1], east: [1, 1] } as const)[front];
  const near = panel(faces, isoCamera(fx, fz), 820, 700, bg), far = panel(faces, isoCamera(-fx, -fz), 820, 700, bg);
  const floors = options.plans === false ? [] : detectFloors(voxels);
  // Cut two above the floor: walls stay (their tops darkened), one-high furniture shows.
  const plans = floors.map(y => panel(buildFaces(voxels, y + 2), TOP, 520, 520, bg, y + 3));
  const gap = 8, topH = Math.max(near.height, far.height), plansW = plans.reduce((s, p) => s + p.width + gap, -gap), plansH = Math.max(0, ...plans.map(p => p.height));
  const out = new Picture(Math.max(near.width + gap + far.width, plansW), topH + (plans.length ? gap + plansH : 0), [255, 255, 255]);
  out.paste(near, 0, 0); out.paste(far, near.width + gap, 0);
  plans.reduce((x, p) => { out.paste(p, x, topH + gap); return x + p.width + gap; }, 0);
  const xs = voxels.map(v => v.x), zs = voxels.map(v => v.z);
  const caption = [
    `上排左：从${NEAR[front]}斜上方看（正面朝${SIDE_NAME[front]}）；上排右：从${FAR[front]}看背面`,
    floors.length ? `下排：${floors.map((y, i) => `第 ${i + 1} 层平面图（地板 y=${y}，切掉 y>${y + 2}，深灰是墙顶，北在上）`).join('；')}` : '没有找到明显的楼层，没画平面图',
    ...floors.flatMap((y, i) => [`第 ${i + 1} 层文字平面图（地板 y=${y}；每行一个 z，从 z=${Math.min(...zs)} 起；每列一个 x，从 x=${Math.min(...xs)} 起，北在上；${PLAN_LEGEND}）：`, ...textPlan(voxels, y).map(r => `|${r}`)]),
  ].join('\n');
  return { png: encodePng(out), caption };
}
