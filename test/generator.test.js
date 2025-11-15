import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  discoverRailsSchemaFiles,
  generateTypespecFromRailsSchema,
  parseRailsSchema
} from '../dist/index.js';

const SCHEMA_WITH_ENUM = `# frozen_string_literal: true

ActiveRecord::Schema[7.1].define(version: 2024_05_14_123456) do
  create_enum "status", ["draft", "published"]

  create_table "users", force: :cascade do |t|
    t.string "name", null: false
    t.string "email", default: "guest@example.com"
    t.integer "age"
    t.references "account", null: false
    t.timestamps
  end

  create_table "accounts", force: :cascade do |t|
    t.string "plan", default: "free"
    t.boolean "active", default: true, null: false
    t.datetime "expires_at"
    t.enum "status", enum_type: "status", default: "draft"
  end
end
`;

async function withTempProject(callback) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rails-typespec-'));
  try {
    await callback(tempRoot);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

test('parseRailsSchema returns structured tables, enums, and diagnostics', () => {
  const { tables, enums, diagnostics } = parseRailsSchema(SCHEMA_WITH_ENUM);

  assert.equal(diagnostics.errors.length, 0);
  assert.ok(diagnostics.warnings.length >= 1, 'fallback warning should be present when Prism is unavailable');

  assert.equal(tables.length, 2);
  assert.equal(enums.length, 1);

  const users = tables.find((table) => table.name === 'users');
  assert(users, 'users table should exist');
  assert.deepEqual(
    users.columns.map((column) => ({ name: column.name, type: column.type })),
    [
      { name: 'name', type: 'string' },
      { name: 'email', type: 'string' },
      { name: 'age', type: 'integer' },
      { name: 'account', type: 'references' },
      { name: 'created_at', type: 'datetime' },
      { name: 'updated_at', type: 'datetime' }
    ]
  );

  const accounts = tables.find((table) => table.name === 'accounts');
  assert(accounts, 'accounts table should exist');
  const statusColumn = accounts.columns.find((column) => column.name === 'status');
  assert(statusColumn, 'accounts table should expose enum column');
  assert.equal(statusColumn.type, 'enum');
  assert.equal(statusColumn.enumName, 'Status');
});

test('generateTypespecFromRailsSchema emits decorated models and enums', () => {
  const { models, enums, diagnostics } = generateTypespecFromRailsSchema(SCHEMA_WITH_ENUM, {
    namespace: 'Example'
  });

  assert.equal(models.length, 2);
  assert.equal(enums.length, 1);
  assert.ok(diagnostics.warnings.length >= 1);

  const usersModel = models.find((model) => model.name === 'Users.tsp');
  assert(usersModel, 'Users.tsp should be generated');
  assert.equal(
    usersModel.content,
    `namespace Example;\n\nmodel Users {\n  name: string;\n  @doc("default: guest@example.com")\n  email?: string;\n  age?: int32;\n  account: int64;\n  created_at: utcDateTime;\n  updated_at: utcDateTime;\n}\n`
  );

  const statusEnum = enums[0];
  assert.equal(
    statusEnum.content,
    `namespace Example;\n\nenum Status {\n  DRAFT: "draft";\n  PUBLISHED: "published";\n}\n`
  );
});

test('discoverRailsSchemaFiles finds conventional and engine schemas', async () => {
  await withTempProject(async (tempRoot) => {
    const projectRoot = path.join(tempRoot, 'app');
    const engineDb = path.join(projectRoot, 'engines/blog/db');

    await fs.mkdir(path.join(projectRoot, 'db'), { recursive: true });
    await fs.mkdir(engineDb, { recursive: true });
    await fs.mkdir(path.join(projectRoot, 'db/migrate'), { recursive: true });

    await fs.writeFile(path.join(projectRoot, 'db/schema.rb'), '# schema');
    await fs.writeFile(path.join(projectRoot, 'db/secondary_schema.rb'), '# secondary schema');
    await fs.writeFile(path.join(engineDb, 'schema.rb'), '# engine schema');
    await fs.writeFile(path.join(projectRoot, 'db/migrate/001_create_users.rb'), '# migration');

    const discovered = await discoverRailsSchemaFiles(projectRoot);
    const relative = discovered.map((entry) => path.relative(projectRoot, entry)).sort();
    assert.deepEqual(relative, ['db/schema.rb', 'db/secondary_schema.rb', 'engines/blog/db/schema.rb']);
  });
});
