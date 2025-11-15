import fs from 'node:fs/promises';
import path from 'node:path';

const SCHEMA_FILE_PATTERN = /_?schema\.rb$/;
const MAX_SEARCH_DEPTH = 4;
const IGNORED_DIRECTORIES = new Set<string>(['.git', 'node_modules', 'tmp', 'log', 'vendor', 'storage', 'migrate']);
const DEFAULT_SCHEMA_FILES = ['db/schema.rb', 'db/primary_schema.rb', 'db/secondary_schema.rb'];

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function collectSchemaFiles(directory: string, results: Set<string>, depth = 0): Promise<void> {
  if (depth > MAX_SEARCH_DEPTH) return;

  let entries: fs.Dirent[];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isFile() && SCHEMA_FILE_PATTERN.test(entry.name)) {
      results.add(path.resolve(entryPath));
      continue;
    }

    if (!entry.isDirectory()) continue;
    if (IGNORED_DIRECTORIES.has(entry.name)) continue;

    await collectSchemaFiles(entryPath, results, depth + 1);
  }
}

async function enumerateDbDirectories(rootDir: string): Promise<Set<string>> {
  const discovered = new Set<string>();

  async function walk(directory: string, depth = 0): Promise<void> {
    if (depth > MAX_SEARCH_DEPTH) return;

    let entries: fs.Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;

      const entryPath = path.join(directory, entry.name);
      if (entry.name === 'db') {
        discovered.add(path.resolve(entryPath));
      }
      await walk(entryPath, depth + 1);
    }
  }

  await walk(rootDir);
  return discovered;
}

export async function discoverRailsSchemaFiles(rootDir: string): Promise<string[]> {
  const absoluteRoot = path.resolve(rootDir);
  const discovered = new Set<string>();

  for (const candidate of DEFAULT_SCHEMA_FILES) {
    const absolute = path.join(absoluteRoot, candidate);
    if (await pathExists(absolute)) {
      discovered.add(path.resolve(absolute));
    }
  }

  const dbDir = path.join(absoluteRoot, 'db');
  if (await pathExists(dbDir)) {
    await collectSchemaFiles(dbDir, discovered);
  }

  const nestedDbDirs = await enumerateDbDirectories(absoluteRoot);
  for (const directory of nestedDbDirs) {
    if (directory === path.resolve(dbDir)) continue;
    await collectSchemaFiles(directory, discovered);
  }

  return Array.from(discovered).sort();
}

