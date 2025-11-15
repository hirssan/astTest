export interface ColumnDefinition {
  name: string;
  rawType: string;
  nullable: boolean;
  defaultValue?: string;
}

export interface TableDefinition {
  name: string;
  columns: ColumnDefinition[];
}

export interface GenerationResult {
  name: string;
  contents: string;
}
