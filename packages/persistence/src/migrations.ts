import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

export interface Migration {
  version: number;
  name: string;
  filename: string;
  bytes: Buffer;
  checksum: string;
}

const migrationFilePattern = /^(\d{3})_([a-z0-9][a-z0-9_-]*)\.sql$/;

function migrationsDirectory(): string {
  // During development __dirname points at src; after build it points at dist.
  return join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
}

export function readMigrations(directory = migrationsDirectory()): Migration[] {
  if (!existsSync(directory)) {
    throw new Error(`Migration directory does not exist: ${directory}`);
  }

  const entries = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const migrations: Migration[] = [];
  const versions = new Set<number>();
  for (const filename of entries) {
    const match = migrationFilePattern.exec(filename);
    if (!match) {
      throw new Error(`Malformed migration filename: ${filename}`);
    }
    const version = Number(match[1]);
    if (versions.has(version)) {
      throw new Error(`Duplicate migration version: ${version}`);
    }
    const name = match[2];
    if (!name) {
      throw new Error(`Malformed migration filename: ${filename}`);
    }
    versions.add(version);
    const bytes = readFileSync(join(directory, filename));
    migrations.push({
      version,
      name,
      filename,
      bytes,
      checksum: createHash("sha256").update(bytes).digest("hex")
    });
  }

  migrations.sort((left, right) => left.version - right.version);
  return migrations;
}

function appliedMigrations(database: DatabaseSync): Array<{ version: number; name: string; checksum: string }> {
  return database
    .prepare("SELECT version, name, checksum FROM schema_migrations ORDER BY version ASC")
    .all() as Array<{ version: number; name: string; checksum: string }>;
}

export function applyMigrations(database: DatabaseSync, directory?: string): void {
  const migrations = readMigrations(directory);
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);

  const availableByVersion = new Map(migrations.map((migration) => [migration.version, migration]));
  for (const applied of appliedMigrations(database)) {
    const migration = availableByVersion.get(applied.version);
    if (!migration) {
      throw new Error(`Applied migration ${applied.version} is missing from disk`);
    }
    if (migration.name !== applied.name || migration.checksum !== applied.checksum) {
      throw new Error(`Migration drift detected for version ${applied.version}`);
    }
  }

  const appliedVersions = new Set(appliedMigrations(database).map((migration) => migration.version));
  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) {
      continue;
    }
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(migration.bytes.toString("utf8"));
      database
        .prepare(
          "INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)"
        )
        .run(migration.version, migration.name, migration.checksum, new Date().toISOString());
      database.exec("COMMIT");
    } catch (error) {
      try {
        database.exec("ROLLBACK");
      } catch {
        // Preserve the original migration failure.
      }
      throw error;
    }
  }
}

export function ensureParentDirectory(databasePath: string): void {
  if (databasePath === ":memory:") {
    return;
  }
  const parent = dirname(databasePath);
  if (parent && parent !== ".") {
    mkdirSync(parent, { recursive: true });
  }
}
