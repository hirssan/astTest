import { mkdirSync, copyFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const distRuby = resolve(root, "dist", "ruby");
const source = resolve(root, "assets", "ripper_fallback.rb");
const target = resolve(distRuby, "ripper_fallback.rb");

mkdirSync(distRuby, { recursive: true });
copyFileSync(source, target);
console.log(`Copied ${source} -> ${target}`);
