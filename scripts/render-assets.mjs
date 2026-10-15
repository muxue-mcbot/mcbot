// 生成蓝图画图用的方块数据 client-runtime/render-assets.json.gz（docs/building_design.md「画图」）。
// 只在开发时跑：从 mcp-server 装好的 prismarine-viewer（MIT）读 1.21.1 的方块模型和贴图集，只留下形状（每个模型的长方体）和每个面的平均颜色，
// 不带贴图本身；方块的默认属性从 minecraft-data／prismarine-block 读。运行端画图只读生成的文件，不依赖这些包。
// 用法：node scripts/render-assets.mjs（先在 mcp-server 里 npm ci）
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = '1.21.1';
const require = createRequire(path.join(ROOT, 'mcp-server', 'package.json'));
const { PNG } = require('pngjs');
const viewer = path.join(path.dirname(require.resolve('prismarine-viewer/package.json')), 'public');
const states = JSON.parse(fs.readFileSync(path.join(viewer, 'blocksStates', `${VERSION}.json`), 'utf8'));
const atlas = PNG.sync.read(fs.readFileSync(path.join(viewer, 'textures', `${VERSION}.png`)));
const mcData = require('minecraft-data')(VERSION);
const Block = require('prismarine-block')(VERSION);

const DIRS = ['down', 'up', 'north', 'south', 'west', 'east'];
const colors = [], colorIndex = new Map();
// 一个面在贴图集里那块的平均颜色：rgb 按不透明程度加权，a 是整块的平均不透明度（玻璃很低，树叶的镂空也算进去）
// su/sv can be negative (the texture stored mirrored), so the range is taken from both ends.
function faceColor(tex, uv) {
  const [u1, v1, u2, v2] = uv ?? [0, 0, 16, 16];
  const span = (start, size, a, b, length) => {
    const ends = [start + size * a / 16, start + size * b / 16].map(t => t * length);
    const from = Math.floor(Math.min(...ends));
    return [from, Math.max(from + 1, Math.ceil(Math.max(...ends)))];
  };
  const [x0, x1] = span(tex.u, tex.su, u1, u2, atlas.width), [y0, y1] = span(tex.v, tex.sv, v1, v2, atlas.height);
  let r = 0, g = 0, b = 0, weight = 0, alpha = 0, count = 0;
  for (let y = Math.max(0, y0); y < Math.min(atlas.height, y1); y++) for (let x = Math.max(0, x0); x < Math.min(atlas.width, x1); x++) {
    const i = (y * atlas.width + x) * 4, a = atlas.data[i + 3];
    count++; alpha += a;
    if (a < 16) continue;
    r += atlas.data[i] * a; g += atlas.data[i + 1] * a; b += atlas.data[i + 2] * a; weight += a;
  }
  const color = weight ? [Math.round(r / weight), Math.round(g / weight), Math.round(b / weight), Math.round(alpha / Math.max(1, count))] : [0, 0, 0, 0];
  const key = color.join(',');
  if (!colorIndex.has(key)) { colorIndex.set(key, colors.length); colors.push(color); }
  return colorIndex.get(key);
}

// 模型 → [[fx,fy,fz,tx,ty,tz,[[面,颜色,遮挡面,染色],...]],...]，相同的只存一份
const models = [], modelIndex = new Map();
function model(m) {
  const elements = (m?.elements ?? []).map(el => [...el.from, ...el.to, Object.entries(el.faces ?? {}).filter(([, f]) => f?.texture)
    .map(([dir, f]) => [DIRS.indexOf(dir), faceColor(f.texture, f.uv), f.cullface ? DIRS.indexOf(f.cullface) : -1, f.tintindex !== undefined ? 1 : 0])]);
  const key = JSON.stringify(elements);
  if (!modelIndex.has(key)) { modelIndex.set(key, models.length); models.push(elements); }
  return modelIndex.get(key);
}
const variant = v => { const one = Array.isArray(v) ? v[0] : v; return [model(one.model), one.x ?? 0, one.y ?? 0]; };

const blocks = {}, defaults = {};
for (const [name, def] of Object.entries(states)) {
  if (def.variants) blocks[name] = { variants: Object.entries(def.variants).map(([key, v]) => [key, variant(v)]) };
  else if (def.multipart) blocks[name] = { multipart: def.multipart.map(p => [p.when ?? null, variant(p.apply)]) };
  else continue;
  const known = mcData.blocksByName[name];
  if (!known) continue;
  const props = {};
  for (const [k, v] of Object.entries(Block.fromStateId(known.defaultState, 0).getProperties())) props[k] = String(v);
  if (Object.keys(props).length) defaults[name] = props;
}

const out = path.join(ROOT, 'client-runtime', 'render-assets.json.gz');
const json = JSON.stringify({ version: VERSION, source: `prismarine-viewer ${require('prismarine-viewer/package.json').version} (MIT)`, colors, models, blocks, defaults });
fs.writeFileSync(out, zlib.gzipSync(json, { level: 9 }));
console.log(`${path.relative(ROOT, out)}：${Object.keys(blocks).length} 种方块、${models.length} 个模型、${colors.length} 种颜色，${Math.round(json.length / 1024)} KB（压缩后 ${Math.round(fs.statSync(out).size / 1024)} KB）`);
