# rails-typespec-generator

Rails の `schema.rb` から [TypeSpec](https://microsoft.github.io/typespec/) の `model` / `enum` 定義を生成するための npm パッケージです。Ruby 3.3 以降で採用されている Prism パーサーを優先的に利用し、取得できない環境では Ruby に同梱された Ripper にフォールバックします。

## 特長

- ✅ Rails の `db/schema.rb` や `db/*_schema.rb`、エンジン配下のスキーマを自動検出
- ✅ Prism の AST を用いた堅牢なパースと、Ripper によるフォールバック
- ✅ `create_table` と `create_enum` から TypeSpec の `model` / `enum` を生成
- ✅ CLI / JavaScript API の両方を提供

## インストール

```bash
npm install rails-typespec-generator
```

> **Note**
> Node.js 18 以降での利用を推奨します。Prism の WebAssembly を取得できない場合は自動的に Ripper フォールバックに切り替わり、診断情報に警告を残します。

## クイックスタート

```bash
npx rails-typespec-generator path/to/rails-app --output ./typespec --namespace MyApp
```

1. `projectRoot` を省略するとカレントディレクトリを基準に Rails プロジェクトを探索します。
2. `db/schema.rb`、`db/*_schema.rb`、`engines/**/db/schema.rb` などの自動生成スキーマを収集します。
3. 生成された TypeSpec ファイルを `--output` で指定したディレクトリ配下に書き出します。

### CLI オプション

| オプション | 説明 | 既定値 |
| --- | --- | --- |
| `--schema, -s` | 自動検出を行わず、指定した `schema.rb` を処理します（複数指定可） | - |
| `--output, -o` | 生成ファイルを書き出すディレクトリ | `./typespec` |
| `--namespace, -n` | 各 TypeSpec ファイルに付与する `namespace` 宣言 | - |
| `--dry-run, -d` | ファイルを書き込まずに標準出力へ表示 | `false` |
| `--force, -f` | 既存ファイルを上書き | `false` |
| `--verbose, -v` | 警告や詳細情報を出力 | `false` |

### 生成例

以下の `db/schema.rb` が存在するとします。

```ruby
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
```

`npx rails-typespec-generator --namespace Example --output ./typespec` を実行すると、`./typespec/Users.tsp` と `./typespec/Status.tsp` が生成されます（複数スキーマが見つかった場合は相対パスに合わせてサブディレクトリを作成します）。

```typespec
namespace Example;

model Users {
  name: string;
  @doc("default: guest@example.com")
  email?: string;
  age?: int32;
  account: int64;
  created_at: utcDateTime;
  updated_at: utcDateTime;
}

enum Status {
  DRAFT: "draft";
  PUBLISHED: "published";
}
```

`--dry-run` を付与するとファイルは作成せず、標準出力で生成内容を確認できます。CI で差分を監視したい場合に便利です。

## JavaScript API

```js
import { generateTypespecFromRailsSchema } from 'rails-typespec-generator';
import { readFileSync } from 'node:fs';

const schema = readFileSync('db/schema.rb', 'utf8');
const result = generateTypespecFromRailsSchema(schema, {
  namespace: 'MyApp'
});

for (const model of result.models) {
  console.log(model.name);
  console.log(model.content);
}
```

返却オブジェクトには以下を含みます。

- `models`: 生成された TypeSpec モデル配列（`name`, `tableName`, `content`）
- `enums`: `create_enum` から生成された TypeSpec enum 配列（`name`, `enumName`, `content`）
- `tables`: AST から抽出したテーブル・カラム情報
- `diagnostics`: Prism / Ripper 実行時の `errors`・`warnings`

## テストと CI

本リポジトリには変換結果を検証する Node.js テストを用意しています。

```bash
npm test
```

Biome による静的解析とフォーマットチェックは以下で実行できます。オプションを追加したい場合は `npm run lint -- --apply` のように末尾へ渡してください。

```bash
npm run lint
```

### Lefthook による自動フォーマット

コミット時に Biome で自動フォーマットを適用したい場合は [Lefthook](https://github.com/evilmartians/lefthook) をセットアップしてください。

```bash
npx lefthook install
```

以後は `git commit` 実行時に `npm run lint -- --apply` が呼び出され、フォーマット済みのファイルが自動的にステージングへ戻されます。

TypeScript で実装されたソースは `npm run build` で `dist/` 以下にコンパイルされ、Ruby フォールバックスクリプトも合わせてコピーされます。パッケージ公開前や手元で CLI を試す際はビルドを実行してください。

GitHub Actions (`.github/workflows/ci.yml`) では `npm run lint` と `npm test` を実行し、Pull Request や push 時に自動で検証します。

## トラブルシューティング

- Prism の WebAssembly を取得できない環境では、自動的に Ripper フォールバックへ切り替わり、診断結果に警告が追加されます。
- Ruby 実行環境がない場合はフォールバックも失敗します。CI では Ruby 3.1 以上を用意してください。

## 制限事項

- Prism AST の仕様変更や Rails の DSL 拡張には追従できない場合があります。
- `t.references` / `t.belongs_to` はデフォルトで `int64` として扱います。`polymorphic: true` の場合は `unknown` を返します。

## ライセンス

MIT
