#!/usr/bin/env node
// 把 deploy/vibemeter-site 各页面 JSON-LD 的 softwareVersion / dateModified
// 同步成 package.json 当前版本。由 npm version 钩子自动调用（见 package.json
// 的 "version" script），release.sh 在 Validate 阶段校验一致性兜底。
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const today = new Date().toISOString().slice(0, 10);
const site = path.join(root, 'deploy', 'vibemeter-site');

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name.endsWith('.html')) yield full;
  }
}

let changed = 0;
for (const file of walk(site)) {
  const text = fs.readFileSync(file, 'utf8');
  if (!text.includes('"softwareVersion"')) continue;
  const next = text
    .replace(/"softwareVersion":\s*"[^"]*"/g, `"softwareVersion": "${version}"`)
    .replace(/"dateModified":\s*"[^"]*"/g, `"dateModified": "${today}"`);
  if (next !== text) {
    fs.writeFileSync(file, next);
    changed += 1;
    console.log(`synced ${path.relative(root, file)} → ${version}`);
  }
}
console.log(changed ? `done: ${changed} file(s)` : `already at ${version}`);
