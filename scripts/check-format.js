#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const candidateBins = [
  resolve(projectRoot, 'node_modules', '@biomejs', 'biome', 'bin', 'biome.cjs'),
  resolve(projectRoot, 'node_modules', '@biomejs', 'biome', 'bin', 'biome.js'),
  resolve(projectRoot, 'node_modules', '@biomejs', 'cli', 'bin', 'biome.cjs'),
  resolve(projectRoot, 'node_modules', '@biomejs', 'cli', 'bin', 'biome.js'),
  resolve(projectRoot, 'node_modules', '@biomejs', 'cli', 'bin', 'biome.mjs'),
  resolve(projectRoot, 'node_modules', '@biomejs', 'cli', 'bin', 'biome'),
  resolve(projectRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'biome.cmd' : 'biome'),
];

const biomeBin = resolvedModuleBin ?? fileCandidates.find((binPath) => existsSync(binPath));

if (!biomeBin) {
  console.error('[@biomejs/biome] Binary not found. Did you run `npm install`?');
  process.exit(1);
}

const biomeArgs = ['check', '.', ...process.argv.slice(2)];
const isNodeScript = /\.(c?m)?js$/.test(biomeBin);
const spawnCommand = isNodeScript ? process.execPath : biomeBin;
const spawnArgs = isNodeScript ? [biomeBin, ...biomeArgs] : biomeArgs;

const result = spawnSync(spawnCommand, spawnArgs, {
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
