#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { discoverRailsSchemaFiles, generateTypespecFromRailsSchema } from '../index.js';
import type { GenerationResult, TypespecDocument } from '../src/parsers/schemaParser.js';

type CliArguments = {
  projectRoot: string;
  schema?: string[] | string;
  output: string;
  namespace?: string;
  dryRun: boolean;
  force: boolean;
  verbose: boolean;
};

type AggregatedResult = {
  schemaFile: string;
  relativeSchema: string;
  result: GenerationResult;
};

type AggregatedDiagnostics = {
  warnings: string[];
  errors: string[];
};

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function formatRelativeSchemaPath(schemaPath: string, projectRoot: string): string {
  const relative = path.relative(projectRoot, schemaPath);
  if (!relative || relative.startsWith('..')) {
    return path.basename(schemaPath);
  }
  return relative;
}

function flattenDocuments(
  results: AggregatedResult[]
): Array<AggregatedResult & { document: TypespecDocument }> {
  const documents: Array<AggregatedResult & { document: TypespecDocument }> = [];
  for (const result of results) {
    for (const document of [...result.result.enums, ...result.result.models]) {
      documents.push({ ...result, document });
    }
  }
  return documents;
}

async function main(): Promise<void> {
  const argv = (await yargs(hideBin(process.argv))
    .scriptName('rails-typespec-generator')
    .usage('$0 [projectRoot] [options]')
    .command(
      '$0 [projectRoot]',
      'Generate TypeSpec models from Rails schema files discovered in the project tree',
      (y) =>
        y
          .positional('projectRoot', {
            describe: 'Root directory of the Rails application',
            type: 'string',
            default: '.'
          })
          .option('schema', {
            alias: 's',
            type: 'array',
            describe: 'Explicit schema.rb file(s) to process instead of automatic discovery'
          })
          .option('output', {
            alias: 'o',
            type: 'string',
            describe: 'Directory where generated TypeSpec files should be written',
            default: './typespec'
          })
          .option('namespace', {
            alias: 'n',
            type: 'string',
            describe: 'Optional TypeSpec namespace declaration'
          })
          .option('dry-run', {
            alias: 'd',
            type: 'boolean',
            describe: 'Print the generated output without writing to disk',
            default: false
          })
          .option('force', {
            alias: 'f',
            type: 'boolean',
            describe: 'Overwrite existing files when writing to disk',
            default: false
          })
          .option('verbose', {
            alias: 'v',
            type: 'boolean',
            describe: 'Print additional diagnostics',
            default: false
          })
          .array('schema')
          .check((args) => {
            if (args.schema) {
              const entries = Array.isArray(args.schema) ? args.schema : [args.schema];
              if (entries.some((value) => typeof value !== 'string')) {
                throw new Error('--schema entries must be file paths');
              }
            }
            return true;
          })
    )
    .help()
    .strict()
    .parse()) as CliArguments;

  const projectRoot = path.resolve(process.cwd(), argv.projectRoot);
  if (!(await pathExists(projectRoot))) {
    console.error(`Project root not found: ${argv.projectRoot}`);
    process.exitCode = 1;
    return;
  }

  const schemaArgument = argv.schema;
  const explicitSchemas = Array.isArray(schemaArgument) ? schemaArgument : schemaArgument ? [schemaArgument] : [];

  const resolvedExplicitSchemas: string[] = [];
  for (const schemaEntry of explicitSchemas) {
    const candidate = path.isAbsolute(schemaEntry)
      ? schemaEntry
      : path.resolve(projectRoot, schemaEntry);
    if (await pathExists(candidate)) {
      resolvedExplicitSchemas.push(path.resolve(candidate));
    } else {
      console.warn(`warning: Skipping missing schema file: ${schemaEntry}`);
    }
  }

  const schemaFiles = resolvedExplicitSchemas.length
    ? resolvedExplicitSchemas
    : await discoverRailsSchemaFiles(projectRoot);

  if (!schemaFiles.length) {
    console.error('No Rails schema files were found. Provide --schema to specify files manually.');
    process.exitCode = 1;
    return;
  }

  const aggregatedResults: AggregatedResult[] = [];
  const aggregatedDiagnostics: AggregatedDiagnostics = { warnings: [], errors: [] };

  for (const schemaFile of schemaFiles) {
    try {
      const schemaContent = await fs.readFile(schemaFile, 'utf8');
      const result = generateTypespecFromRailsSchema(schemaContent, {
        namespace: argv.namespace
      });
      const relativeSchema = formatRelativeSchemaPath(schemaFile, projectRoot);

      aggregatedResults.push({ schemaFile, relativeSchema, result });

      for (const warning of result.diagnostics.warnings) {
        aggregatedDiagnostics.warnings.push(`[${relativeSchema}] ${warning}`);
      }
      for (const error of result.diagnostics.errors) {
        aggregatedDiagnostics.errors.push(`[${relativeSchema}] ${error}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      aggregatedDiagnostics.errors.push(
        `[${formatRelativeSchemaPath(schemaFile, projectRoot)}] ${message}`
      );
    }
  }

  if (argv.verbose) {
    for (const warning of aggregatedDiagnostics.warnings) {
      console.warn(`warning: ${warning}`);
    }
    for (const error of aggregatedDiagnostics.errors) {
      console.error(`error: ${error}`);
    }
  }

  if (aggregatedDiagnostics.errors.length) {
    console.error('Generation aborted due to parser errors.');
    process.exitCode = 1;
    return;
  }

  const outputs = flattenDocuments(aggregatedResults);

  if (!outputs.length) {
    console.warn('No tables or enums were detected in the discovered schema files.');
    return;
  }

  if (argv.dryRun) {
    for (const { relativeSchema, document } of outputs) {
      console.log(`\n// Schema: ${relativeSchema}\n// File: ${document.name}\n${document.content}`);
    }
    return;
  }

  const outputRoot = path.resolve(process.cwd(), argv.output);

  for (const { schemaFile, document, relativeSchema } of outputs) {
    const schemaDirRelative = path.relative(projectRoot, path.dirname(schemaFile));
    const safeRelativeDir = schemaDirRelative && !schemaDirRelative.startsWith('..') ? schemaDirRelative : '';
    const targetDir = safeRelativeDir ? path.join(outputRoot, safeRelativeDir) : outputRoot;
    await fs.mkdir(targetDir, { recursive: true });

    const outputPath = path.join(targetDir, document.name);
    try {
      await fs.writeFile(outputPath, document.content, { flag: argv.force ? 'w' : 'wx' });
      if (argv.verbose) {
        console.log(`Wrote ${outputPath}`);
      }
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError?.code === 'EEXIST') {
        console.error(`File already exists: ${outputPath}. Use --force to overwrite.`);
      } else {
        const message = nodeError?.message ?? String(error);
        console.error(`Failed to write ${outputPath} (from ${relativeSchema}): ${message}`);
      }
      process.exitCode = 1;
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
