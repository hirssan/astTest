export {
	generateTypespecFromRailsSchema,
	parseRailsSchema,
} from "./parsers/schemaParser.js";
export type {
	ColumnDefinition,
	ColumnOptions,
	Diagnostics,
	EnumDefinition,
	GenerationResult,
	ParsedSchema,
	TableDefinition,
	TypespecDocument,
} from "./parsers/schemaParser.js";
export { discoverRailsSchemaFiles } from "./discovery.js";
