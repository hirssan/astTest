import { emitDocument } from "./generator/emit.js";
import { parseSchema } from "./generator/parser.js";
import type { GenerationResult } from "./generator/types.js";

export interface GenerateOptions {
  schema: string;
}

export function generate(options: GenerateOptions): GenerationResult {
  const tables = parseSchema(options.schema);
  const contents = emitDocument(tables);
  return {
    name: "schema.tsp",
    contents,
  };
}

export type { ColumnDefinition, TableDefinition } from "./generator/types.js";
export { parseSchema } from "./generator/parser.js";
export { emitDocument, emitTypeSpecModel } from "./generator/emit.js";
