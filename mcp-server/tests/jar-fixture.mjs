// 测试用的假 jar：只有 MANIFEST 和 neoforge.mods.toml 的 zip（webui-plugins、webui-games、webui-update 的测试共用）。
import zlib from 'node:zlib';

/** 最小的 zip：每个条目一个本地头加中央目录；deflate 为 true 时压缩（读的时候不查 CRC，这里写 0）。 */
export function zip(entries, deflate = false) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const raw = Buffer.from(text), data = deflate ? zlib.deflateRawSync(raw) : raw, n = Buffer.from(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(deflate ? 8 : 0, 8); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(deflate ? 8 : 0, 10); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, n, data); centrals.push(ch, n); offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(centrals.length / 2, 8); end.writeUInt16LE(centrals.length / 2, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
export const modJar = (modId, version, { extra = '', deflate = true, manifest } = {}) => zip({
  'META-INF/MANIFEST.MF': manifest || 'Manifest-Version: 1.0\n',
  'META-INF/neoforge.mods.toml': `modLoader="javafml"\n[[mods]]\nmodId="${modId}"\nversion="${version}"\n${extra}[[dependencies.${modId}]]\nmodId="neoforge"\nversion="[21,)"\n`,
}, deflate);

