#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(scriptDir, '..');
  const source = path.join(projectRoot, 'src', 'parsers', 'rubyFallback.rb');
  const destination = path.join(projectRoot, 'dist', 'src', 'parsers', 'rubyFallback.rb');

  try {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[copy-assets] Failed to copy rubyFallback.rb: ${message}`);
  }
}

main();
