import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { APP_VERSION } from '../dist/app-version.js';

// MCP 服务报给 Agent 的版本跟着 package.json 走（set-version.mjs app 只改那里），不再写死
test('the MCP servers report the app version from package.json', () => {
  assert.equal(APP_VERSION, JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
});
