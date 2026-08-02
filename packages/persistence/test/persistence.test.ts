import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import type * as Sqlite from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase, ProjectRepository, readMigrations, transaction } from "../src/index.js";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof Sqlite;

function temporaryDirectory(): string {
  return mkdtempSync(join(tmpdir(), "story-creator-test-"));
}

describe("SQLite persistence", () => {
  it("creates all three modes and orders projects deterministically", () => {
    const database = openDatabase();
    try {
      const repository = new ProjectRepository(database);
      const first = repository.create({ name: " First ", entryMode: "premise" }, {
        id: "00000000-0000-4000-8000-000000000001",
        now: new Date("2025-01-01T00:00:00.000Z")
      });
      const second = repository.create({ name: "Second", entryMode: "import-mend" }, {
        id: "00000000-0000-4000-8000-000000000002",
        now: new Date("2025-01-02T00:00:00.000Z")
      });
      const third = repository.create({ name: "Third", entryMode: "import-continue" }, {
        id: "00000000-0000-4000-8000-000000000003",
        now: new Date("2025-01-03T00:00:00.000Z")
      });
      expect(repository.list()).toEqual([third, second, first]);
      expect(repository.get(second.id)).toEqual(second);
      expect(repository.get("missing")).toBeUndefined();
    } finally {
      database.close();
    }
  });

  it("persists across close and reopen", () => {
    const directory = temporaryDirectory();
    const path = join(directory, "nested", "projects.sqlite");
    const id = "00000000-0000-4000-8000-000000000010";
    const firstDatabase = openDatabase(path);
    new ProjectRepository(firstDatabase).create({ name: "Persisted", entryMode: "premise" }, { id });
    firstDatabase.close();
    const reopened = openDatabase(path);
    try {
      expect(new ProjectRepository(reopened).get(id)?.name).toBe("Persisted");
    } finally {
      reopened.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rolls back a failed write after the INSERT executes", () => {
    const database = openDatabase();
    try {
      const repository = new ProjectRepository(database);
      expect(() => transaction(database, (transactionDatabase) => {
        transactionDatabase
          .prepare(
            "INSERT INTO projects (id, name, entry_mode, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
          )
          .run(
            "00000000-0000-4000-8000-000000000099",
            "Will roll back",
            "premise",
            "active",
            "2025-01-01T00:00:00.000Z",
            "2025-01-01T00:00:00.000Z"
          );
        throw new Error("simulated failed write");
      })).toThrow("simulated failed write");
      expect(repository.list()).toHaveLength(0);
    } finally {
      database.close();
    }
  });
});

describe("numbered migrations", () => {
  it("is idempotent and records exact checksums", () => {
    const database = openDatabase();
    try {
      const row = database.prepare("SELECT version, name, checksum FROM schema_migrations").get() as {
        version: number;
        name: string;
        checksum: string;
      };
      expect(row.version).toBe(1);
      expect(row.name).toBe("initial");
      expect(row.checksum).toBeTruthy();
      expect(() => readMigrations()).not.toThrow();
    } finally {
      database.close();
    }
  });

  it("rejects malformed and duplicate migration versions", () => {
    const directory = temporaryDirectory();
    try {
      writeFileSync(join(directory, "bad.sql"), "SELECT 1;");
      expect(() => readMigrations(directory)).toThrow(/Malformed/);
      rmSync(join(directory, "bad.sql"));
      writeFileSync(join(directory, "001_one.sql"), "SELECT 1;");
      writeFileSync(join(directory, "001_two.sql"), "SELECT 1;");
      expect(() => readMigrations(directory)).toThrow(/Duplicate/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rolls back a failed migration without a ledger row", () => {
    const directory = temporaryDirectory();
    const migrationDirectory = join(directory, "migrations");
    mkdirSync(migrationDirectory);
    writeFileSync(join(migrationDirectory, "001_failure.sql"), "CREATE TABLE should_not_remain (id INTEGER); SELECT * FROM missing_table;");
    const databasePath = join(directory, "database.sqlite");
    expect(() => openDatabase(databasePath, { migrationDirectory })).toThrow();
    const database = new DatabaseSync(databasePath);
    try {
      expect(() => database.prepare("SELECT * FROM should_not_remain").all()).toThrow();
      expect(database.prepare("SELECT count(*) AS count FROM schema_migrations").get()).toEqual({ count: 0 });
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("detects checksum drift for an applied version", () => {
    const directory = temporaryDirectory();
    const migrationDirectory = join(directory, "migrations");
    mkdirSync(migrationDirectory);
    const migration = join(migrationDirectory, "001_initial.sql");
    writeFileSync(migration, "CREATE TABLE drifted (id INTEGER);");
    const databasePath = join(directory, "database.sqlite");
    const database = openDatabase(databasePath, { migrationDirectory });
    database.close();
    writeFileSync(migration, "CREATE TABLE drifted (id INTEGER, value TEXT);");
    expect(() => openDatabase(databasePath, { migrationDirectory })).toThrow(/drift/);
    rmSync(directory, { recursive: true, force: true });
  });
});
