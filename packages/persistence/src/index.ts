import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import type * as Sqlite from "node:sqlite";
import type { CreateProjectInput, ProjectEntryMode, ProjectRecord } from "@story-creator/domain";
import { parseCreateProjectInput, parseProjectRecord } from "@story-creator/domain";
import { applyMigrations, ensureParentDirectory } from "./migrations.js";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof Sqlite;

export type { Migration } from "./migrations.js";
export { applyMigrations, readMigrations } from "./migrations.js";

export interface OpenDatabaseOptions {
  readonly?: boolean;
  timeout?: number;
  migrationDirectory?: string;
}

export function openDatabase(databasePath = ":memory:", options: OpenDatabaseOptions = {}): DatabaseSyncType {
  ensureParentDirectory(databasePath);
  const { migrationDirectory, ...databaseOptions } = options;
  const database = new DatabaseSync(databasePath, databaseOptions);
  try {
    database.exec("PRAGMA foreign_keys = ON");
    applyMigrations(database, migrationDirectory);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

export function transaction<T>(database: DatabaseSyncType, operation: (database: DatabaseSyncType) => T): T {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = operation(database);
    database.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // Preserve the operation failure.
    }
    throw error;
  }
}

interface ProjectRow {
  id: string;
  name: string;
  entry_mode: ProjectEntryMode;
  status: "active";
  created_at: string;
  updated_at: string;
}

function projectRecord(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    entryMode: row.entry_mode,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export interface CreateProjectOptions {
  id?: string;
  now?: Date;
}

export class ProjectRepository {
  public constructor(private readonly database: DatabaseSyncType) {}

  public create(input: CreateProjectInput, options: CreateProjectOptions = {}): ProjectRecord {
    const parsed = parseCreateProjectInput(input);
    const id = options.id ?? randomUUID();
    const now = (options.now ?? new Date()).toISOString();
    const record: ProjectRecord = parseProjectRecord({
      id,
      name: parsed.name,
      entryMode: parsed.entryMode,
      status: "active",
      createdAt: now,
      updatedAt: now
    });
    transaction(this.database, () => {
      this.database
        .prepare(
          "INSERT INTO projects (id, name, entry_mode, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)"
        )
        .run(id, parsed.name, parsed.entryMode, now, now);
    });
    return record;
  }

  public list(): ProjectRecord[] {
    const rows = this.database
      .prepare(
        "SELECT id, name, entry_mode, status, created_at, updated_at FROM projects ORDER BY updated_at DESC, id ASC"
      )
      .all() as unknown as ProjectRow[];
    return rows.map(projectRecord);
  }

  public get(projectId: string): ProjectRecord | undefined {
    const row = this.database
      .prepare(
        "SELECT id, name, entry_mode, status, created_at, updated_at FROM projects WHERE id = ?"
      )
      .get(projectId) as unknown as ProjectRow | undefined;
    return row ? projectRecord(row) : undefined;
  }
}

export type { DatabaseSyncType as DatabaseSync };
