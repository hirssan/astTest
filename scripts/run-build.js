#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

async function ensureTscPath() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const candidate = path.join(scriptDir, '..', 'node_modules', 'typescript', 'lib', 'tsc.js');

  try {
    await fs.access(candidate);
    return candidate;
  } catch {
    throw new Error(
      'TypeScript compiler not found. Install dependencies with `bun install` or `npm install` before building.'
    );
  }
}

async function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
      } else if (typeof code === 'number') {
        reject(new Error(`${command} exited with code ${code}`));
      } else {
        reject(new Error(`${command} terminated due to signal ${signal ?? 'unknown'}`));
      }
    });
    child.on('error', (error) => {
      reject(error);
    });
  });
}

async function main() {
  const tscPath = await ensureTscPath();
  await runCommand(process.execPath, [tscPath, '-p', 'tsconfig.json']);
  await import('./copy-assets.js');
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[run-build] ${message}`);
  process.exitCode = 1;
});
