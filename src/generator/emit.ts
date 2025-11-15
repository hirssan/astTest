import { TableDefinition } from "./types.js";
import { mapColumnType } from "./parser.js";

export function emitTypeSpecModel(table: TableDefinition): string {
  const lines: string[] = [];
  lines.push(`model ${pascalCase(table.name)} {`);
  for (const column of table.columns) {
    const typeSpecType = mapColumnType(column.rawType);
    const optional = column.nullable ? "?" : "";
    lines.push(`  ${column.name}${optional}: ${typeSpecType};`);
  }
  lines.push("}");
  return lines.join("\n");
}

export function emitDocument(tables: TableDefinition[]): string {
  return tables.map((table) => emitTypeSpecModel(table)).join("\n\n");
}

function pascalCase(input: string): string {
  return input
    .split(/_|\s+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join("");
}
