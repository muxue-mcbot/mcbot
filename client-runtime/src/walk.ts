import { parseState } from './blueprints.js';

/**
 * Walks a design like a player (docs/building_design.md, walk): from the ground outside, every place a player can stand
 * and get to, walking (steps of half a block, drops of up to three) and with one-block jumps (players mostly have auto-jump);
 * then, indoors, the places nobody gets to: an upper floor the stairs do not reach, a stair that hits the head, a room a
 * table shuts. 10-15/16 trials: models did not see these in their own pictures; the player did, walking in.
 *
 * Heights are in half blocks; a player is 1.8 tall. A cell's shape is approximated: passable (air, plants, torches, doors,
 * carpets...), a bottom or top half (slabs, beds, stairs), a full block, or a fence or wall one and a half high. Furniture
 * (beds, chests, tables, a stair used as a chair) is in the way and never stood on. The ground under and round the design is
 * taken as flat, one below its lowest layer.
 */
type Block = [number, number, number, string];
type State = { name: string; props: Record<string, string> };
const TALL = 3.6, JUMP = 2, DROP = 6;
const PASSABLE = /^(air|cave_air|void_air|water|light|lever|tripwire|tripwire_hook|redstone_wire|cobweb|snow|lily_pad|structure_void|bubble_column|nether_sprouts|crimson_roots|warped_roots|hanging_roots|spore_blossom|frogspawn|sculk_vein|glow_lichen)$|(torch|sign|button|pressure_plate|carpet|banner|rail|_door|fence_gate|trapdoor|sapling|tulip|poppy|dandelion|orchid|allium|bluet|daisy|cornflower|lily_of_the_valley|wither_rose|torchflower|short_grass|tall_grass|fern|dead_bush|sunflower|lilac|rose_bush|peony|pink_petals|sugar_cane|sweet_berry_bush|wheat|carrots|potatoes|beetroots|seagrass|kelp|kelp_plant|_mushroom|_fungus|pitcher_plant|pitcher_crop)$/;
const CLIMB = /^(ladder|vine|scaffolding|twisting_vines|twisting_vines_plant|weeping_vines|weeping_vines_plant|cave_vines|cave_vines_plant)$/;
const FURNITURE = /_bed$|chest$|barrel|crafting_table|furnace|smoker|anvil|cauldron|composter|loom|lectern|stonecutter|grindstone|_table$|brewing_stand|jukebox|note_block|bookshelf|flower_pot|^potted_|lantern|campfire|bell|beehive|bee_nest|decorated_pot|candle|cake|_skull$|_head$/;
const STEP_DIR: Record<string, [number, number]> = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };

// A whole block to stand on or to lean against: not passable, not furniture, not a half or a post.
const fullBlock = (s?: State) => !!s && !PASSABLE.test(s.name) && !CLIMB.test(s.name) && !FURNITURE.test(s.name) && !/_slab$|_stairs$|_fence$|_wall$/.test(s.name);

interface Column { solid: [number, number][]; floors: Set<number>; climb: Set<number> }
export interface WalkReport { unreachable: string[] }

export function walkDesign(blocks: Block[]): WalkReport {
  const cells = new Map<string, State>();
  for (const [x, y, z, state] of blocks) { const s = parseState(state); if (s.name !== 'air') cells.set(`${x},${y},${z}`, s); }
  if (!cells.size) return { unreachable: [] };
  const at = (x: number, y: number, z: number) => cells.get(`${x},${y},${z}`);
  const coords = [...cells.keys()].map(k => k.split(',').map(Number));
  const [x0, x1, y0, z0, z1] = [Math.min(...coords.map(c => c[0])), Math.max(...coords.map(c => c[0])), Math.min(...coords.map(c => c[1])), Math.min(...coords.map(c => c[2])), Math.max(...coords.map(c => c[2]))];
  // A stair is a step when it leads somewhere: the next step up, a landing or floor level with its top or a block above that,
  // or the step below. Otherwise it is a chair.
  const step = (x: number, y: number, z: number, s: State) => {
    const [dx, dz] = STEP_DIR[s.props.facing ?? 'north'] ?? [0, -1];
    const up = at(x + dx, y + 1, z + dz), level = at(x + dx, y, z + dz), below = at(x - dx, y - 1, z - dz);
    return !!up && (up.name.endsWith('_stairs') || fullBlock(up)) || fullBlock(level) || !!below && below.name.endsWith('_stairs');
  };
  const columns = new Map<string, Column>();
  const column = (x: number, z: number) => {
    const k = `${x},${z}`;
    let c = columns.get(k);
    // The ground: a full block under the lowest layer.
    if (!c) { c = { solid: [[2 * (y0 - 1), 2 * y0]], floors: new Set([2 * y0]), climb: new Set() }; columns.set(k, c); }
    return c;
  };
  for (const [k, s] of cells) {
    const [x, y, z] = k.split(',').map(Number), c = column(x, z), { name, props } = s;
    if (CLIMB.test(name)) { c.climb.add(2 * y); continue; }
    if (PASSABLE.test(name)) continue;
    const under = at(x, y - 1, z);
    // Never a place to stand: furniture, a chair, anything on a fence or wall (a table top on its leg).
    const furniture = FURNITURE.test(name) || !!under && /_fence$|_wall$/.test(under.name)
      || name.endsWith('_stairs') && (props.half === 'top' || !step(x, y, z, s));
    let [from, to] = [0, 2];
    if (name.endsWith('_slab')) [from, to] = props.type === 'top' ? [1, 2] : props.type === 'double' ? [0, 2] : [0, 1];
    else if (name.endsWith('_stairs') && props.half !== 'top' && !furniture) [from, to] = [0, 1];
    else if (/_bed$|^(stonecutter|daylight_detector|campfire|soul_campfire|cake)$/.test(name)) [from, to] = [0, 1];
    else if (/_fence$|_wall$/.test(name)) [from, to] = [0, 3];
    c.solid.push([2 * y + from, 2 * y + to]);
    if (furniture || to > 2) continue;
    c.floors.add(2 * y + to);
    // A stair is a ramp: its low side half a block up, its high side a whole block.
    if (name.endsWith('_stairs')) c.floors.add(2 * y + 2);
  }
  // Nothing solid between the feet and the top of the head. A step counts only as its low half, so its high side stays a place to stand.
  const clearAt = (c: Column, f: number, top: number) => c.solid.every(([s, e]) => !(s < top && e > f));
  const standable = (x: number, z: number, f: number) => {
    const c = column(x, z);
    return (c.floors.has(f) || f % 2 === 0 && c.climb.has(f / 2)) && clearAt(c, f, f + TALL);
  };
  const byColumn = new Map<string, number[]>();
  const nodes: [number, number, number][] = [];
  for (let x = x0 - 2; x <= x1 + 2; x++) for (let z = z0 - 2; z <= z1 + 2; z++) {
    const c = column(x, z), heights = new Set([...c.floors, ...[...c.climb].map(y => 2 * y)]);
    for (const f of heights) if (standable(x, z, f)) { nodes.push([x, z, f]); byColumn.set(`${x},${z}`, [...(byColumn.get(`${x},${z}`) ?? []), f]); }
  }
  const key = (x: number, z: number, f: number) => `${x},${z},${f}`;
  const moves = (x: number, z: number, f: number): [number, number, number][] => {
    const out: [number, number, number][] = [], here = column(x, z);
    const climbing = f % 2 === 0 && here.climb.has(f / 2);
    // Within a column: a stair's two sides, or up and down a ladder.
    for (const g of byColumn.get(`${x},${z}`) ?? []) if (g !== f && (Math.abs(g - f) <= 1 || climbing && Math.abs(g - f) <= 2) && clearAt(here, Math.min(f, g), Math.max(f, g) + TALL)) out.push([x, z, g]);
    for (const [dx, dz] of Object.values(STEP_DIR)) {
      const there = column(x + dx, z + dz);
      for (const g of byColumn.get(`${x + dx},${z + dz}`) ?? []) {
        if (g - f < -DROP || g - f > JUMP) continue;
        // Both columns clear from their own floor to the head over the higher feet: going up, half the body is still over the
        // lower one (a stair under a two-high opening hits the head); going down, the body comes over at the higher height.
        const top = Math.max(f, g) + TALL;
        if (clearAt(here, f, top) && clearAt(there, g, top)) out.push([x + dx, z + dz, g]);
      }
    }
    return out;
  };
  const outside = (x: number, z: number) => x < x0 || x > x1 || z < z0 || z > z1;
  const edge = (x: number, z: number) => x === x0 || x === x1 || z === z0 || z === z1;
  const open = (x: number, z: number, f: number) => !column(x, z).solid.some(([s]) => s >= f + TALL);
  // Where a player comes from: the ground round it, and the design's own edge under the open sky up to a block above the
  // ground (models lay grass or a path as the lowest layer; the step onto it is the terrain's, not the house's).
  const seen = new Set<string>(), queue: [number, number, number][] = [];
  for (const [x, z, f] of nodes) if (outside(x, z) && f === 2 * y0 || edge(x, z) && f <= 2 * y0 + 2 && open(x, z, f)) { seen.add(key(x, z, f)); queue.push([x, z, f]); }
  while (queue.length) for (const n of moves(...queue.pop()!)) if (!seen.has(key(...n))) { seen.add(key(...n)); queue.push(n); }
  // Indoors: something solid over the head, and a wall (anything solid at body height) somewhere out along all four sides;
  // a porch or the platform under the eaves is open to one side.
  const walled = (x: number, z: number, f: number) => Object.values(STEP_DIR).every(([dx, dz]) => {
    for (let k = 1; !outside(x + dx * k, z + dz * k); k++) if (!clearAt(column(x + dx * k, z + dz * k), f, f + TALL)) return true;
    return false;
  });
  const left = new Map(nodes.filter(([x, z, f]) => !seen.has(key(x, z, f)) && !outside(x, z) && !open(x, z, f) && walled(x, z, f)).map(n => [key(...n), n] as const));
  const groups: [number, number, number][][] = [];
  for (const [k, start] of left) {
    if (!left.has(k)) continue;
    const group = [start]; left.delete(k);
    for (let i = 0; i < group.length; i++) for (const n of moves(...group[i])) if (left.has(key(...n))) { group.push(n); left.delete(key(...n)); }
    // A strip a block wide is the top of a wall or a ledge under the roof, not somewhere to go.
    const wide = (i: 0 | 1) => new Set(group.map(n => n[i])).size > 1;
    if (group.length >= 6 && wide(0) && wide(1)) groups.push(group);
  }
  return {
    unreachable: groups.sort((a, b) => b.length - a.length).slice(0, 4).map(group => {
      // The block stood on (a half block within its own cell).
      const floors = group.map(n => Math.ceil(n[2] / 2) - 1), low = Math.min(...floors), high = Math.max(...floors);
      const gx = group.map(n => n[0]), gz = group.map(n => n[1]);
      return `脚踩 y=${low === high ? low : `${low}～${high}`} 的一片 ${group.length} 格（x ${Math.min(...gx)}～${Math.max(...gx)}，z ${Math.min(...gz)}～${Math.max(...gz)}）`;
    }),
  };
}

/**
 * Stairs written one by one the wrong way round. facing is a stair's high half: a chair's back, the way up a step. 10-16 Sonnet
 * took it for where a seat looks and turned every chair, bench and door step of a house round (the stairs part sets it right).
 * Looked at: a stair standing on a floor, not in a flight, with its back to a table (a top on a leg, or a slab on the floor),
 * or with its low side against a block and its high side to open space (a bench facing the wall, a step that rises away from
 * the door).
 */
export function backwardStairs(blocks: Block[]): string[] {
  const cells = new Map<string, State>();
  for (const [x, y, z, state] of blocks) { const s = parseState(state); if (s.name !== 'air') cells.set(`${x},${y},${z}`, s); }
  const at = (x: number, y: number, z: number) => cells.get(`${x},${y},${z}`);
  const y0 = Math.min(...blocks.map(b => b[1]));
  const open = (s?: State) => !s || PASSABLE.test(s.name);
  const onFloor = (x: number, y: number, z: number) => y === y0 || fullBlock(at(x, y - 1, z));
  const table = (x: number, y: number, z: number) => {
    const s = at(x, y, z), top = at(x, y + 1, z);
    return !!s && onFloor(x, y, z) && (/_fence$|_wall$/.test(s.name) && !!top && /pressure_plate|carpet|_slab$/.test(top.name) || s.name.endsWith('_slab') && s.props.type !== 'double');
  };
  const out: string[] = [];
  for (const [k, s] of cells) {
    if (!s.name.endsWith('_stairs') || s.props.half === 'top') continue;
    const [x, y, z] = k.split(',').map(Number), [dx, dz] = STEP_DIR[s.props.facing ?? 'north'] ?? [0, -1];
    if (at(x + dx, y + 1, z + dz)?.name.endsWith('_stairs') || at(x - dx, y - 1, z - dz)?.name.endsWith('_stairs') || !onFloor(x, y, z)) continue;
    const why = table(x + dx, y, z + dz) && !table(x - dx, y, z - dz) ? '椅背对着桌子'
      : fullBlock(at(x - dx, y, z - dz)) && open(at(x + dx, y, z + dz)) && open(at(x + dx, y + 1, z + dz)) ? '高的一边朝着空处，低的一边顶着方块' : '';
    if (why) out.push(`(${x},${y},${z}) ${s.name}[facing=${s.props.facing}] ${why}`);
  }
  return out;
}
