/**
 * Applies src/db/schema.sql to the configured Turso database.
 * Run with: npm run migrate
 * (loads .env via dotenv; idempotent — uses IF NOT EXISTS).
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createClient } from "@libsql/client";

const __dirname = dirname(fileURLToPath(import.meta.url));

const url = process.env.TURSO_DATABASE_URL;
if (!url) {
  console.error("Missing TURSO_DATABASE_URL (set it in .env). See .env.example.");
  process.exit(1);
}

const schemaPath = resolve(__dirname, "../src/db/schema.sql");
const schema = readFileSync(schemaPath, "utf8");

// Strip full-line comments, then split into statements on ';'.
const statements = schema
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .split(";")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

async function main() {
  const client = createClient({
    url: url as string,
    authToken: process.env.TURSO_AUTH_TOKEN || undefined,
  });

  try {
    for (const sql of statements) {
      await client.execute(sql);
      console.log("✓", sql.split("\n")[0].slice(0, 60));
    }
    console.log(`\nMigration complete (${statements.length} statements).`);
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  } finally {
    client.close();
  }
}

void main();
