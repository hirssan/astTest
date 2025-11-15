declare module 'node:fs/promises' {
  export interface Dirent {
    name: string;
    isFile(): boolean;
    isDirectory(): boolean;
  }

  export function access(path: string): Promise<void>;
  export function readdir(path: string, options?: unknown): Promise<Dirent[]>;
  export function readFile(path: string, options: { encoding: string } | string): Promise<string>;
  export function writeFile(path: string, data: string, options?: { flag?: string }): Promise<void>;
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  export function rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  export function copyFile(src: string, dest: string): Promise<void>;
  export function mkdtemp(prefix: string): Promise<string>;
}

declare module 'node:path' {
  export function join(...paths: string[]): string;
  export function resolve(...paths: string[]): string;
  export function relative(from: string, to: string): string;
  export function basename(path: string): string;
  export function dirname(path: string): string;
  export function isAbsolute(path: string): boolean;
}

declare module 'node:process' {
  const process: {
    argv: string[];
    cwd(): string;
    exit(code?: number): never;
    exitCode?: number | null;
    env: Record<string, string | undefined>;
  };
  export default process;
}

declare namespace NodeJS {
  interface ErrnoException extends Error {
    code?: string;
  }
}

declare module 'node:child_process' {
  export interface SpawnSyncOptionsWithStringEncoding {
    input?: string;
    encoding?: 'utf8';
  }

  export interface SpawnSyncReturns<T> {
    stdout: T;
    stderr: T;
    status: number | null;
    error?: Error;
  }

  export function spawnSync(
    command: string,
    args?: readonly string[],
    options?: SpawnSyncOptionsWithStringEncoding
  ): SpawnSyncReturns<string>;
}

declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}

declare module '@ruby/prism' {
  export interface PrismDiagnostic {
    message?: string;
  }

  export interface PrismResult {
    ast?: unknown;
    value?: unknown;
    errors?: (PrismDiagnostic | string)[] | null;
    warnings?: (PrismDiagnostic | string)[] | null;
  }

  export function parse(source: string, options?: Record<string, unknown>): PrismResult;

  const prism: {
    parse: typeof parse;
  };

  export default prism;
}

declare module 'yargs' {
  export interface Argv<TArgs = Record<string, unknown>> {
    scriptName(name: string): Argv<TArgs>;
    usage(usage: string): Argv<TArgs>;
    command(
      command: string,
      description: string,
      builder: (argv: Argv<TArgs>) => Argv<TArgs>
    ): Argv<TArgs>;
    positional(name: string, options: { describe?: string; type?: string; default?: unknown }): Argv<TArgs>;
    option(
      name: string,
      options: { alias?: string; type?: string; describe?: string; default?: unknown }
    ): Argv<TArgs>;
    array(key: string): Argv<TArgs>;
    check(checker: (args: TArgs) => boolean): Argv<TArgs>;
    help(): Argv<TArgs>;
    strict(): Argv<TArgs>;
    parse(): Promise<TArgs>;
  }

  export default function yargs<TArgs = Record<string, unknown>>(
    args?: readonly string[]
  ): Argv<TArgs>;
}

declare module 'yargs/helpers' {
  export function hideBin(argv: string[]): string[];
}
