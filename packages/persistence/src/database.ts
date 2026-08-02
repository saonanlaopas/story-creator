import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import type * as Sqlite from "node:sqlite";
import { applyMigrations, ensureParentDirectory } from "./migrations.js";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof Sqlite;

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

export type { DatabaseSyncType as DatabaseSync };
