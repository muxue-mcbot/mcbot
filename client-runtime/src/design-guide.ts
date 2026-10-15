import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BodyError } from './body.js';

/**
 * The design notes the model reads before designing (blueprints action guide): building-guide.md next to package.json.
 * Without a topic the general sections and the list of styles; with one, that style ("## 风格：<name>").
 */
const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'building-guide.md');
const STYLE = '风格：';

export function designGuide(topic?: string): string {
  const [, ...sections] = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n').split(/^## /m);
  const titled = sections.map(text => ({ title: text.slice(0, text.indexOf('\n')).trim(), text: `## ${text.trim()}` }));
  const styles = titled.filter(s => s.title.startsWith(STYLE));
  const names = styles.map(s => s.title.slice(STYLE.length));
  if (!topic) return [...titled.filter(s => !s.title.startsWith(STYLE)).map(s => s.text), `风格（guide 带 topic 看）：${names.join('、')}`].join('\n\n');
  const found = styles.find(s => s.title.slice(STYLE.length) === topic) ?? styles.find(s => s.title.includes(topic));
  if (!found) throw new BodyError('NOT_FOUND', `没有「${topic}」这个风格，有：${names.join('、')}`);
  return found.text;
}
