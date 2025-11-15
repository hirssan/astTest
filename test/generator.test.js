import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const modulePath = new URL("../dist/index.js", import.meta.url);
const generator = await import(modulePath);

test("parses schema and emits TypeSpec", () => {
  const schema = `create_table "users" do |t|
  t.string "name", null: false
  t.integer "age"
end`;
  const result = generator.generate({ schema });
  assert.equal(result.name, "schema.tsp");
  assert.match(result.contents, /model Users/);
  assert.match(result.contents, /name: string/);
  assert.match(result.contents, /age\?: int32/);
});

test("assets are copied during build", async () => {
  const assetPath = resolve(new URL("../dist/ruby", import.meta.url).pathname, "ripper_fallback.rb");
  const contents = await readFile(assetPath, "utf8");
  assert.ok(contents.includes("Placeholder"));
});
