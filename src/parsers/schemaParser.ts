import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rubyFallbackScriptPath = fileURLToPath(new URL('./rubyFallback.rb', import.meta.url));

type PrismParseFunction = (source: string, options?: Record<string, unknown>) => PrismParseResult;

type PrismDiagnostic = { message?: string } | string;

type PrismParseResult = {
  ast?: unknown;
  value?: unknown;
  errors?: PrismDiagnostic[] | null;
  warnings?: PrismDiagnostic[] | null;
};

interface RubyFallbackColumn {
  name?: string;
  type?: string;
  options?: Record<string, unknown>;
  enumName?: string;
}

interface RubyFallbackTable {
  name?: string;
  columns?: RubyFallbackColumn[];
}

interface RubyFallbackEnum {
  name?: string;
  values?: unknown;
}

interface RubyFallbackPayload {
  tables?: RubyFallbackTable[];
  enums?: RubyFallbackEnum[];
  warnings?: unknown;
  errors?: unknown;
}

export interface ColumnOptions extends Record<string, unknown> {
  default?: unknown;
  null?: boolean;
  limit?: number;
  enum_type?: string;
  enum?: string;
  name?: string;
  polymorphic?: boolean;
}

export interface ColumnDefinition {
  name: string;
  type: string;
  options: ColumnOptions;
  enumName?: string;
}

export interface TableDefinition {
  name: string;
  className: string;
  columns: ColumnDefinition[];
}

export interface EnumDefinition {
  name: string;
  className: string;
  values: string[];
}

export interface Diagnostics {
  warnings: string[];
  errors: string[];
}

export interface ParsedSchema {
  tables: TableDefinition[];
  enums: EnumDefinition[];
  diagnostics: Diagnostics;
}

export interface TypespecDocument {
  name: string;
  content: string;
  tableName?: string;
  enumName?: string;
}

export interface GenerationResult {
  models: TypespecDocument[];
  enums: TypespecDocument[];
  tables: TableDefinition[];
  diagnostics: Diagnostics;
}

const TIMESTAMP_COLUMNS: ReadonlyArray<ColumnDefinition> = [
  { name: 'created_at', type: 'datetime', options: { null: false } },
  { name: 'updated_at', type: 'datetime', options: { null: false } }
];

const TYPESPEC_TYPE_BY_RAILS_TYPE = new Map<string, string>(
  Object.entries({
    string: 'string',
    text: 'string',
    citext: 'string',
    uuid: 'string',
    integer: 'int32',
    int: 'int32',
    bigint: 'int64',
    float: 'float64',
    decimal: 'decimal',
    numeric: 'decimal',
    boolean: 'boolean',
    datetime: 'utcDateTime',
    timestamp: 'utcDateTime',
    timestamptz: 'utcDateTime',
    date: 'plainDate',
    time: 'plainTime',
    binary: 'bytes',
    json: 'Record<string, unknown>',
    jsonb: 'Record<string, unknown>'
  })
);

const { prismParse, prismLoadError } = await loadPrismParser();

async function loadPrismParser(): Promise<{
  prismParse: PrismParseFunction | null;
  prismLoadError: Error | null;
}> {
  try {
    const prismModule = await import('@ruby/prism');
    const parseFn = (prismModule as { parse?: PrismParseFunction })?.parse ??
      (prismModule as { default?: { parse?: PrismParseFunction } })?.default?.parse;
    if (typeof parseFn === 'function') {
      return { prismParse: parseFn, prismLoadError: null };
    }
    const error = new Error('@ruby/prism に parse 関数が見つかりませんでした');
    return { prismParse: null, prismLoadError: error };
  } catch (error) {
    return {
      prismParse: null,
      prismLoadError: error instanceof Error ? error : new Error(String(error))
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toJsonNode(node: unknown): unknown {
  if (!isRecord(node)) return node;
  return typeof (node as { toJSON?: () => unknown }).toJSON === 'function'
    ? (node as { toJSON: () => unknown }).toJSON()
    : node;
}

type PrismVisitor = (node: Record<string, unknown>, parent: Record<string, unknown> | null) => void;

function visitPrismAst(node: unknown, visitor: PrismVisitor, parent: Record<string, unknown> | null = null): void {
  if (!node) return;
  const json = toJsonNode(node);
  if (!isRecord(json)) return;

  const nodeType = typeof json.type === 'string' ? json.type : typeof json.kind === 'string' ? json.kind : null;
  if (nodeType) {
    visitor(json, parent);
  }

  for (const value of Object.values(json)) {
    if (value === null || value === undefined) continue;

    if (Array.isArray(value)) {
      for (const element of value) {
        visitPrismAst(element, visitor, json);
      }
      continue;
    }

    if (isRecord(value) && (typeof value.type === 'string' || typeof value.kind === 'string' || typeof (value as { toJSON?: () => unknown }).toJSON === 'function')) {
      visitPrismAst(value, visitor, json);
    }
  }
}

function extractIdentifierName(node: unknown): string | undefined {
  if (!node) return undefined;
  if (typeof node === 'string') return node;
  const json = toJsonNode(node);
  if (!json) return undefined;
  if (typeof (json as { name?: string }).name === 'string') return (json as { name: string }).name;
  if (typeof (json as { value?: string }).value === 'string') return (json as { value: string }).value;
  const nameValue = (json as { name?: { value?: string } })?.name?.value;
  if (typeof nameValue === 'string') return nameValue;
  const idName = (json as { id?: { name?: string } })?.id?.name;
  if (typeof idName === 'string') return idName;
  const idValue = (json as { id?: { value?: string } })?.id?.value;
  if (typeof idValue === 'string') return idValue;
  return undefined;
}

function literalFromNode(node: unknown, source: string): unknown {
  if (!node) return undefined;
  const json = toJsonNode(node);

  if (typeof json === 'string' || typeof json === 'number' || typeof json === 'boolean') {
    return json;
  }

  if (isRecord(json)) {
    const value = json.value;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }

    if (Array.isArray((json as { parts?: unknown[] }).parts)) {
      return ((json as { parts: unknown[] }).parts).map((part) => literalFromNode(part, source)).join('');
    }

    if (Array.isArray((json as { elements?: unknown[] }).elements)) {
      return ((json as { elements: unknown[] }).elements).map((element) => literalFromNode(element, source));
    }

    const locationCandidate = (json.location ?? json.loc ?? json) as Record<string, unknown> | undefined;
    const startOffset = typeof locationCandidate?.startOffset === 'number' ? locationCandidate.startOffset : undefined;
    const endOffset = typeof locationCandidate?.endOffset === 'number' ? locationCandidate.endOffset : undefined;
    if (typeof startOffset === 'number' && typeof endOffset === 'number') {
      const raw = source.slice(startOffset, endOffset);
      if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
        return raw.slice(1, -1);
      }
      if (raw.startsWith(':')) return raw.slice(1);
      if (raw === 'true') return true;
      if (raw === 'false') return false;
      return raw;
    }
  }

  return undefined;
}

function arrayFromNode(node: unknown, source: string): string[] {
  const json = toJsonNode(node) as Record<string, unknown> | undefined;
  const parts =
    (json?.elements as unknown) ??
    (json?.args as unknown) ??
    (json?.arguments as unknown) ??
    (json?.items as unknown) ??
    (json?.contents as unknown) ??
    (json?.parts as unknown) ??
    [];

  if (!Array.isArray(parts)) return [];
  return parts
    .map((part) => literalFromNode(part, source))
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
}

function argumentsFromCall(callNode: unknown): unknown[] {
  const json = toJsonNode(callNode) as Record<string, unknown> | undefined;
  if (!json) return [];

  if (Array.isArray(json.arguments)) return json.arguments.map((argument) => toJsonNode(argument));
  if (Array.isArray((json.arguments as { arguments?: unknown[] } | undefined)?.arguments)) {
    return ((json.arguments as { arguments: unknown[] }).arguments).map((argument) => toJsonNode(argument));
  }
  if (Array.isArray(json.args)) return json.args.map((argument) => toJsonNode(argument));
  return [];
}

function blockStatements(blockNode: unknown): unknown[] {
  const json = toJsonNode(blockNode) as Record<string, unknown> | undefined;
  if (!json) return [];

  if (Array.isArray(json.body)) return json.body;
  if (Array.isArray((json.body as { statements?: unknown[] } | undefined)?.statements)) {
    return (json.body as { statements: unknown[] }).statements;
  }
  if (Array.isArray((json.statements as { body?: unknown[] } | undefined)?.body)) {
    return (json.statements as { body: unknown[] }).body;
  }
  if (Array.isArray((json.body as { body?: unknown[] } | undefined)?.body)) {
    return (json.body as { body: unknown[] }).body;
  }
  return [];
}

function optionsFromNode(node: unknown, source: string): ColumnOptions {
  const json = toJsonNode(node) as Record<string, unknown> | undefined;
  const pairs =
    (json?.elements as unknown) ??
    (json?.assocs as unknown) ??
    (json?.arguments as unknown) ??
    (json?.pairs as unknown);
  if (!Array.isArray(pairs)) return {};

  return pairs.reduce<ColumnOptions>((acc, pair) => {
    const pairJson = toJsonNode(pair);
    const record = isRecord(pairJson) ? pairJson : undefined;
    const tuple = Array.isArray(pairJson) ? pairJson : Array.isArray(pair) ? pair : undefined;
    const keyNode = record?.key ?? record?.name ?? tuple?.[0];
    const key = literalFromNode(keyNode, source);
    if (typeof key !== 'string' || key.length === 0) {
      return acc;
    }
    const valueNode = record?.value ?? record?.val ?? tuple?.[1];
    acc[key] = literalFromNode(valueNode, source);
    return acc;
  }, {});
}

function classifyTableName(tableName: unknown): string {
  if (!tableName || typeof tableName !== 'string') return 'Model';
  return tableName
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function snakeCase(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

function normalizeEnumMemberName(value: string): string | undefined {
  if (!value) return undefined;
  const sanitized = value
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');
  if (!sanitized) return undefined;
  const prefixed = /^[0-9]/.test(sanitized) ? `_${sanitized}` : sanitized;
  return prefixed.toUpperCase();
}

function inferTypespecType(column: ColumnDefinition): string {
  const normalized = column.type.toLowerCase();
  if (normalized === 'enum') {
    return column.enumName ?? 'string';
  }

  if (normalized === 'references' || normalized === 'belongs_to' || normalized === 'foreign_key') {
    return column.options?.polymorphic ? 'unknown' : 'int64';
  }

  return TYPESPEC_TYPE_BY_RAILS_TYPE.get(normalized) ?? 'unknown';
}

function createColumnsFromBlock(blockNode: unknown, source: string): ColumnDefinition[] {
  const statements = blockStatements(blockNode);
  const columns: ColumnDefinition[] = [];

  for (const statement of statements) {
    const json = toJsonNode(statement);
    if (!isRecord(json)) continue;
    const nodeType = (json.type ?? json.kind) as string | undefined;
    if (nodeType !== 'CallNode' && nodeType !== 'call_node') continue;

    const methodName = extractIdentifierName(json.name ?? json.method ?? json.identifier);
    if (!methodName) continue;

    if (methodName === 'timestamps' || methodName === 't.timestamps') {
      columns.push(...TIMESTAMP_COLUMNS.map((column) => ({ ...column, options: { ...column.options } })));
      continue;
    }

    const args = argumentsFromCall(json);
    if (args.length === 0) continue;

    const columnName = literalFromNode(args[0], source);
    if (typeof columnName !== 'string') continue;

    const options = args.length > 1 ? optionsFromNode(args[1], source) : {};
    let enumName: string | undefined;
    if (methodName === 'enum') {
      const rawEnum = options?.enum_type ?? options?.enum ?? options?.name;
      if (typeof rawEnum === 'string' && rawEnum.length > 0) {
        enumName = classifyTableName(rawEnum);
      }
    }

    columns.push({
      name: String(columnName).replace(/"/g, ''),
      type: methodName,
      options,
      enumName
    });
  }

  return columns;
}

function extractTableFromBlock(blockNode: unknown, source: string): TableDefinition | null {
  const json = toJsonNode(blockNode) as Record<string, unknown> | undefined;
  const call = json?.call ?? json?.statement ?? json?.target;
  const callJson = toJsonNode(call) as Record<string, unknown> | undefined;
  const methodName = extractIdentifierName(callJson?.name ?? callJson?.method ?? callJson?.identifier);
  if (methodName !== 'create_table') return null;

  const args = argumentsFromCall(callJson);
  if (args.length === 0) return null;

  const tableName = literalFromNode(args[0], source);
  if (typeof tableName !== 'string' || tableName.length === 0) return null;

  return {
    name: tableName,
    className: classifyTableName(tableName),
    columns: createColumnsFromBlock(json, source)
  };
}

function extractEnumFromCall(callNode: unknown, source: string): EnumDefinition | null {
  const json = toJsonNode(callNode) as Record<string, unknown> | undefined;
  const methodName = extractIdentifierName(json?.name ?? json?.method ?? json?.identifier);
  if (methodName !== 'create_enum') return null;

  const args = argumentsFromCall(json);
  if (args.length === 0) return null;
  const enumName = literalFromNode(args[0], source);
  if (typeof enumName !== 'string' || enumName.length === 0) return null;

  return {
    name: enumName,
    className: classifyTableName(enumName),
    values: args.length > 1 ? arrayFromNode(args[1], source) : []
  };
}

function renderEnum(enumDefinition: EnumDefinition): string {
  const lines = [`enum ${enumDefinition.className} {`];
  for (const value of enumDefinition.values) {
    const memberName = normalizeEnumMemberName(value);
    if (!memberName) continue;
    lines.push(`  ${memberName}: "${value}";`);
  }
  lines.push('}');
  return lines.join('\n');
}

function renderModel(table: TableDefinition): string {
  const lines = [`model ${table.className} {`];
  for (const column of table.columns) {
    const decorators: string[] = [];
    if (column.options?.default !== undefined) {
      decorators.push(`@doc("default: ${String(column.options.default)}")`);
    }
    if (column.options?.limit !== undefined) {
      decorators.push(`@doc("limit: ${String(column.options.limit)}")`);
    }

    for (const decorator of decorators) {
      lines.push(`  ${decorator}`);
    }

    const type = inferTypespecType(column);
    const optionalFlag = column.options?.null !== false ? '?' : '';
    lines.push(`  ${snakeCase(column.name)}${optionalFlag}: ${type};`);
  }
  lines.push('}');
  return lines.join('\n');
}

function prefixNamespace(content: string, namespace?: string): string {
  if (!namespace) return `${content}\n`;
  return [`namespace ${namespace};`, '', content, ''].join('\n');
}

function normalizeDiagnostics(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list.map((entry) => {
    if (entry && typeof entry === 'object' && 'message' in entry && typeof (entry as { message: unknown }).message === 'string') {
      return (entry as { message: string }).message;
    }
    return String(entry);
  });
}

function parseWithPrism(schemaContent: string): ParsedSchema {
  if (!prismParse) {
    return {
      tables: [],
      enums: [],
      diagnostics: { errors: ['@ruby/prism が利用できません。'], warnings: [] }
    };
  }

  let result: PrismParseResult | undefined;
  try {
    result = prismParse(schemaContent, { json: true });
  } catch (error) {
    return {
      tables: [],
      enums: [],
      diagnostics: {
        errors: [error instanceof Error ? error.message : String(error)],
        warnings: []
      }
    };
  }

  const ast = toJsonNode(result?.ast ?? result?.value ?? result);
  const tables: TableDefinition[] = [];
  const enums: EnumDefinition[] = [];

  visitPrismAst(ast, (node) => {
    const nodeType = (node.type ?? node.kind) as string | undefined;
    if (nodeType === 'BlockNode' || nodeType === 'block_node') {
      const table = extractTableFromBlock(node, schemaContent);
      if (table) tables.push(table);
      return;
    }
    if (nodeType === 'CallNode' || nodeType === 'call_node') {
      const enumDefinition = extractEnumFromCall(node, schemaContent);
      if (enumDefinition) enums.push(enumDefinition);
    }
  });

  return {
    tables,
    enums,
    diagnostics: {
      errors: normalizeDiagnostics(result?.errors),
      warnings: normalizeDiagnostics(result?.warnings)
    }
  };
}

function parseWithRubyFallback(schemaContent: string): ParsedSchema {
  const result = spawnSync('ruby', [rubyFallbackScriptPath], {
    input: schemaContent,
    encoding: 'utf8'
  }) as SpawnSyncReturns<string>;

  if (result.error) {
    const warning = prismLoadError
      ? `@ruby/prism を読み込めなかったため Ruby フォールバックに失敗しました: ${prismLoadError.message}`
      : 'Ruby フォールバックパーサーの実行に失敗しました。';
    return {
      tables: [],
      enums: [],
      diagnostics: {
        errors: [result.error.message ?? String(result.error)],
        warnings: [warning]
      }
    };
  }

  let payload: RubyFallbackPayload = {};
  try {
    payload = JSON.parse(result.stdout || '{}') as RubyFallbackPayload;
  } catch (error) {
    const warning = prismLoadError
      ? `@ruby/prism を読み込めなかったため Ruby フォールバックの結果を解釈できませんでした: ${prismLoadError.message}`
      : 'Ruby フォールバックの結果を解釈できませんでした。';
    return {
      tables: [],
      enums: [],
      diagnostics: {
        errors: [error instanceof Error ? error.message : String(error)],
        warnings: [warning]
      }
    };
  }

  const tables: TableDefinition[] = Array.isArray(payload.tables)
    ? payload.tables
        .filter((table): table is RubyFallbackTable & { name: string } => typeof table.name === 'string')
        .map((table) => ({
          name: table.name,
          className: classifyTableName(table.name),
          columns: Array.isArray(table.columns)
            ? table.columns
                .filter((column): column is RubyFallbackColumn & { name: string; type: string } =>
                  typeof column.name === 'string' && typeof column.type === 'string'
                )
                .map((column) => {
                  const options = isRecord(column.options) ? (column.options as ColumnOptions) : {};
                  let enumName = column.enumName;
                  if (!enumName && column.type === 'enum') {
                    const raw = (options.enum_type ?? options.enum ?? options.name) as unknown;
                    if (typeof raw === 'string' && raw.length > 0) {
                      enumName = classifyTableName(raw);
                    }
                  }
                  return {
                    name: column.name,
                    type: column.type,
                    options,
                    enumName
                  } satisfies ColumnDefinition;
                })
            : []
        }))
    : [];

  const enums: EnumDefinition[] = Array.isArray(payload.enums)
    ? payload.enums
        .filter((definition): definition is Required<RubyFallbackEnum> & { name: string } => typeof definition.name === 'string')
        .map((definition) => ({
          name: definition.name,
          className: classifyTableName(definition.name),
          values: Array.isArray(definition.values)
            ? definition.values.filter((value): value is string => typeof value === 'string')
            : []
        }))
    : [];

  const warnings = Array.isArray(payload.warnings)
    ? payload.warnings.map((warning) => String(warning))
    : [];
  warnings.push(
    prismLoadError
      ? `@ruby/prism を読み込めなかったため Ruby の Ripper フォールバックを使用しました: ${prismLoadError.message}`
      : '@ruby/prism が見つからないため Ruby の Ripper フォールバックを使用しました。'
  );

  const errors = Array.isArray(payload.errors)
    ? payload.errors.map((error) => String(error))
    : [];
  if (result.status !== 0) {
    errors.push(`Ruby フォールバックが終了ステータス ${result.status} で失敗しました。`);
  }

  return {
    tables,
    enums,
    diagnostics: {
      errors,
      warnings
    }
  };
}

export function parseRailsSchema(schemaContent: string): ParsedSchema {
  if (prismParse) {
    return parseWithPrism(schemaContent);
  }
  return parseWithRubyFallback(schemaContent);
}

export function generateTypespecFromRailsSchema(
  schemaContent: string,
  options: { namespace?: string } = {}
): GenerationResult {
  const { namespace } = options;
  const { tables, enums, diagnostics } = parseRailsSchema(schemaContent);

  const enumDocuments: TypespecDocument[] = enums.map((enumDefinition) => ({
    name: `${enumDefinition.className}.tsp`,
    enumName: enumDefinition.name,
    content: prefixNamespace(renderEnum(enumDefinition), namespace)
  }));

  const modelDocuments: TypespecDocument[] = tables.map((table) => ({
    name: `${table.className}.tsp`,
    tableName: table.name,
    content: prefixNamespace(renderModel(table), namespace)
  }));

  return {
    models: modelDocuments,
    enums: enumDocuments,
    tables,
    diagnostics
  };
}

export { prismLoadError };
