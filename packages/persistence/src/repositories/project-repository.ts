import { randomUUID } from "node:crypto";
import type { CreateProjectInput, ProjectEntryMode, ProjectRecord } from "@story-creator/domain";
import { parseCreateProjectInput, parseProjectRecord } from "@story-creator/domain";
import type { DatabaseSync } from "../database.js";
import { transaction } from "../database.js";

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
  public constructor(private readonly database: DatabaseSync) {}

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
