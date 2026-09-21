#!/usr/bin/env node
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function allow() {
  process.stdout.write('{"permission":"allow"}\n');
  process.exit(0);
}

function deny() {
  process.stdout.write(
    '{"permission":"deny","agent_message":"No hay un change activo en openspec/changes/. Crea uno con /opsx:new antes de editar codigo."}\n',
  );
  process.exit(0);
}

const chunks = [];
for await (const chunk of process.stdin) {
  chunks.push(chunk);
}
const input = Buffer.concat(chunks).toString('utf8');

const filePathMatch = input.match(/"file_path"\s*:\s*"([^"]+)"/);
const pathMatch = input.match(/"path"\s*:\s*"([^"]+)"/);
let filePath = filePathMatch?.[1] ?? pathMatch?.[1] ?? '';
if (!filePath) {
  allow();
}

filePath = filePath.replaceAll('\\', '/').replace(/\/+/g, '/');

const isCodePath =
  /(?:^|\/)apps\//.test(filePath) || /(?:^|\/)libs\//.test(filePath);
if (!isCodePath) {
  allow();
}

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const changesDir = join(root, 'openspec', 'changes');
let active = false;
try {
  for (const name of readdirSync(changesDir, { withFileTypes: true })) {
    if (name.isDirectory() && name.name !== 'archive') {
      active = true;
      break;
    }
  }
} catch {
  deny();
}

if (!active) {
  deny();
}
allow();