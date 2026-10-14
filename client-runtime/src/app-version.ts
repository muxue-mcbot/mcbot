import fs from 'node:fs';

// The app version (shared by the app and the core mod) lives in client-runtime/package.json; scripts/set-version.mjs changes it there.
export const APP_VERSION = (JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;
