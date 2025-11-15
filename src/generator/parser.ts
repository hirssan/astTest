import { ColumnDefinition, TableDefinition } from "./types.js";

const TYPE_MAP: Record<string, string> = {
  string: "string",
  text: "string",
  integer: "int32",
  bigint: "int64",
  float: "float32",
  decimal: "decimal",
  boolean: "boolean",
  date: "plainDate",
  datetime: "utcDateTime",
};

const COLUMN_REGEX = /t\.(\w+)\s+"(\w+)"(.*)/;

export function parseSchema(schema: string): TableDefinition[] {
  const tables: TableDefinition[] = [];
  const lines = schema.split(/\r?\n/);
  let current: TableDefinition | null = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith("create_table")) {
      const nameMatch = line.match(/"([^"]+)"/);
      if (nameMatch) {
        current = { name: nameMatch[1], columns: [] };
        tables.push(current);
      }
      continue;
    }

    if (line.startsWith("end")) {
      current = null;
      continue;
    }

    if (!current) continue;
    const colMatch = line.match(COLUMN_REGEX);
    if (!colMatch) continue;
    const [, rawType, colName, modifierText] = colMatch;
    const nullable = !modifierText.includes("null: false");
    const defaultMatch = modifierText.match(/default: ([^,]+)/);
    const column: ColumnDefinition = {
      name: colName,
      rawType,
      nullable,
      defaultValue: defaultMatch?.[1],
    };
    current.columns.push(column);
  }

  return tables;
}

export function mapColumnType(rawType: string): string {
  return TYPE_MAP[rawType] ?? "unknown";
}
