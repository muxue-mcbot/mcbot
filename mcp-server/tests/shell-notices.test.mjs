import test from 'node:test';
import assert from 'node:assert/strict';
import { renderNotices, thirdParty } from '../../scripts/shell-notices.mjs';

const pkg = (name, version, license) => ({ id: `${name}@${version}`, name, version, license, manifest_path: `/x/${name}/Cargo.toml`, repository: `https://example.com/${name}` });
const META = {
  workspace_members: ['shell@0.0.0'],
  packages: [pkg('shell', '0.0.0', 'Apache-2.0'), pkg('b', '1.0.0', 'MIT'), pkg('a', '2.0.0', 'MIT OR Apache-2.0'), pkg('c', '0.1.0', 'MPL-2.0'), pkg('unused', '1.0.0', 'GPL-3.0')],
  resolve: { nodes: [
    { id: 'shell@0.0.0', deps: [{ pkg: 'a@2.0.0' }, { pkg: 'b@1.0.0' }] },
    { id: 'a@2.0.0', deps: [{ pkg: 'c@0.1.0' }] },
    { id: 'b@1.0.0', deps: [] }, { id: 'c@0.1.0', deps: [] }, { id: 'unused@1.0.0', deps: [] },
  ] },
};

test('mcbot.exe notices: only crates reachable from the shell, sorted, without the shell itself', () => {
  assert.deepEqual(thirdParty(META).map((p) => p.name), ['a', 'b', 'c']);
});

test('mcbot.exe notices: every crate lists its license and source, identical texts appear once, crates without files are named', () => {
  const files = { a: [{ name: 'LICENSE-MIT', text: 'MIT TEXT' }], b: [{ name: 'LICENSE', text: 'MIT TEXT' }], c: [] };
  const out = renderNotices(thirdParty(META), (p) => files[p.name]);
  assert.match(out, /- c 0\.1\.0  许可证：MPL-2\.0  源码：https:\/\/crates\.io\/crates\/c\/0\.1\.0  https:\/\/example\.com\/c/);
  assert.equal(out.split('MIT TEXT').length - 1, 1, '全文一样的只附一次');
  assert.match(out, /适用于：a 2\.0\.0（LICENSE-MIT）、b 1\.0\.0（LICENSE）/);
  assert.match(out, /没有附带许可证文件.*：c 0\.1\.0/);
  assert.doesNotMatch(out, /unused|GPL/);
});
