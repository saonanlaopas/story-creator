import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import type * as Sqlite from "node:sqlite";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { openDatabase, ProjectRepository, readMigrations, SourceRepository, transaction } from "../src/index.js";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof Sqlite;

function temporaryDirectory(): string {
  return mkdtempSync(join(tmpdir(), "story-creator-test-"));
}

const migration001FixturePath = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "migration-001.sqlite");
const migration001Path = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations", "001_initial.sql");

function fileHash(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
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

  it("rolls back multiple successful writes when a later operation fails", () => {
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
            "First write",
            "premise",
            "active",
            "2025-01-01T00:00:00.000Z",
            "2025-01-01T00:00:00.000Z"
          );
        transactionDatabase
          .prepare(
            "INSERT INTO projects (id, name, entry_mode, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
          )
          .run(
            "00000000-0000-4000-8000-000000000100",
            "Second write",
            "import-mend",
            "active",
            "2025-01-02T00:00:00.000Z",
            "2025-01-02T00:00:00.000Z"
          );
        expect(transactionDatabase.prepare("SELECT count(*) AS count FROM projects").get()).toEqual({ count: 2 });
        throw new Error("simulated failed write");
      })).toThrow("simulated failed write");
      expect(repository.list()).toHaveLength(0);
    } finally {
      database.close();
    }
  });
});

describe("immutable source documents", () => {
  it("normalizes Unicode text and creates deterministic chapter and scene segments", () => {
    const database = openDatabase();
    try {
      const projects = new ProjectRepository(database);
      const firstProject = projects.create({ name: "Source one", entryMode: "import-mend" }, {
        id: "00000000-0000-4000-8000-000000000020",
        now: new Date("2025-01-01T00:00:00.000Z")
      });
      const secondProject = projects.create({ name: "Source two", entryMode: "import-mend" }, {
        id: "00000000-0000-4000-8000-000000000021",
        now: new Date("2025-01-01T00:00:00.000Z")
      });
      const repository = new SourceRepository(database);
      const input = {
        filename: "story.txt",
        mediaType: "text/plain" as const,
        encoding: "utf-8" as const,
        text: "\uFEFFChapter 1: Arrival\r\n🙂 “Olá”\r---\r\nChapter II\r日本語"
      };
      const first = repository.create(firstProject.id, input, { now: new Date("2025-01-02T00:00:00.000Z") });
      const second = repository.create(secondProject.id, input, { now: new Date("2025-01-02T00:00:00.000Z") });

      expect(first.document.normalizedText).toBe("Chapter 1: Arrival\n🙂 “Olá”\n---\nChapter II\n日本語");
      expect(first.document.filename).toBe("story.txt");
      expect(first.document.mediaType).toBe("text/plain");
      expect(first.document.encoding).toBe("utf-8");
      expect(first.document.contentHash).toHaveLength(64);
      expect(first.document.normalizedTextHash).toHaveLength(64);
      expect(first.segmentation.algorithmVersion).toBe("source-segmentation-v1");
      expect(first.segments.map((segment) => ({
        id: segment.id,
        parentId: segment.parentId,
        kind: segment.kind,
        position: segment.position,
        heading: segment.heading,
        startOffset: segment.startOffset,
        endOffset: segment.endOffset,
        text: segment.text,
        fingerprint: segment.fingerprint
      }))).toEqual(second.segments.map((segment) => ({
        id: segment.id,
        parentId: segment.parentId,
        kind: segment.kind,
        position: segment.position,
        heading: segment.heading,
        startOffset: segment.startOffset,
        endOffset: segment.endOffset,
        text: segment.text,
        fingerprint: segment.fingerprint
      })));
      expect(first.segments.map((segment) => ({ kind: segment.kind, heading: segment.heading }))).toEqual([
        { kind: "chapter", heading: "Chapter 1: Arrival" },
        { kind: "scene", heading: null },
        { kind: "chapter", heading: "Chapter II" }
      ]);
      expect(first.segments[1]?.parentId).toBe(first.segments[0]?.id);
      expect(first.segments[1]?.startOffset).toBe(first.document.normalizedText.indexOf("---"));
      expect(first.segments[1]?.startOffset).toBe("Chapter 1: Arrival\n🙂 “Olá”\n".length);
      expect(first.segments[2]?.startOffset).toBe(first.document.normalizedText.indexOf("Chapter II"));
    } finally {
      database.close();
    }
  });

  it("recognizes Markdown headings, warns on ambiguous headings, and falls back to one segment", () => {
    const database = openDatabase();
    try {
      const project = new ProjectRepository(database).create({ name: "Markdown source", entryMode: "import-mend" }, {
        id: "00000000-0000-4000-8000-000000000022"
      });
      const repository = new SourceRepository(database);
      const markdown = repository.create(project.id, {
        filename: "story.md",
        mediaType: "text/markdown",
        encoding: "utf-8",
        text: "# Part One\nopening\n## Arrival\nscene\n### Unsupported\nprose\n---\nend"
      });
      expect(markdown.segments.map((segment) => ({ kind: segment.kind, heading: segment.heading }))).toEqual([
        { kind: "chapter", heading: "Part One" },
        { kind: "scene", heading: "Arrival" },
        { kind: "scene", heading: null }
      ]);
      expect(markdown.document.warnings).toEqual([
        "Ambiguous heading-like line at UTF-16 offset 36; preserved as prose."
      ]);

      const plain = repository.create(project.id, {
        filename: "plain.txt",
        mediaType: "text/plain",
        encoding: "utf-8",
        text: "🙂 “No headings” 日本語"
      });
      expect(plain.segments).toHaveLength(1);
      expect(plain.segments[0]).toMatchObject({ kind: "unknown", startOffset: 0, endOffset: plain.document.normalizedText.length });

      const empty = repository.create(project.id, {
        filename: "empty.txt",
        mediaType: "text/plain",
        encoding: "utf-8",
        text: ""
      });
      expect(empty.segments).toEqual([expect.objectContaining({ kind: "unknown", startOffset: 0, endOffset: 0, text: "" })]);
    } finally {
      database.close();
    }
  });

  it("rejects source updates and enforces project ownership with cascade cleanup", () => {
    const database = openDatabase();
    try {
      const projects = new ProjectRepository(database);
      const owner = projects.create({ name: "Owner", entryMode: "import-mend" }, {
        id: "00000000-0000-4000-8000-000000000023"
      });
      const other = projects.create({ name: "Other", entryMode: "import-mend" }, {
        id: "00000000-0000-4000-8000-000000000024"
      });
      const repository = new SourceRepository(database);
      const source = repository.create(owner.id, {
        filename: "immutable.txt",
        mediaType: "text/plain",
        encoding: "utf-8",
        text: "Original"
      });

      expect(repository.get(other.id, source.document.id)).toBeUndefined();
      expect(() => database.prepare("UPDATE source_documents SET normalized_text = ? WHERE id = ?").run("Changed", source.document.id)).toThrow(/immutable/i);
      expect(repository.get(owner.id, source.document.id)?.document.normalizedText).toBe("Original");

      database.prepare("DELETE FROM projects WHERE id = ?").run(owner.id);
      expect(repository.get(owner.id, source.document.id)).toBeUndefined();
      expect(database.prepare("SELECT count(*) AS count FROM source_documents").get()).toEqual({ count: 0 });
      expect(database.prepare("SELECT count(*) AS count FROM source_segmentations").get()).toEqual({ count: 0 });
      expect(database.prepare("SELECT count(*) AS count FROM source_segments").get()).toEqual({ count: 0 });
      expect(projects.get(other.id)?.name).toBe("Other");
    } finally {
      database.close();
    }
  });

  it("enforces source and segmentation ownership with composite foreign keys", () => {
    const database = openDatabase();
    try {
      const projects = new ProjectRepository(database);
      const project = projects.create({ name: "Constraint project", entryMode: "import-mend" }, {
        id: "00000000-0000-4000-8000-000000000026"
      });
      const otherProject = projects.create({ name: "Other constraint project", entryMode: "import-mend" }, {
        id: "00000000-0000-4000-8000-000000000027"
      });
      const repository = new SourceRepository(database);
      const sourceA = repository.create(project.id, {
        filename: "source-a.txt",
        mediaType: "text/plain",
        encoding: "utf-8",
        text: "Source A"
      }, { id: "00000000-0000-4000-8000-000000000028", segmentationVersionId: "00000000-0000-4000-8000-000000000029" });
      const sourceB = repository.create(otherProject.id, {
        filename: "source-b.txt",
        mediaType: "text/plain",
        encoding: "utf-8",
        text: "Source B"
      }, { id: "00000000-0000-4000-8000-000000000030", segmentationVersionId: "00000000-0000-4000-8000-000000000031" });
      expect(repository.get(project.id, sourceA.document.id)?.segments).toHaveLength(1);

      const segmentInsert = database.prepare(
        `INSERT INTO source_segments
          (id, source_document_id, segmentation_version_id, parent_id, kind, position, heading, start_offset, end_offset, content, fingerprint)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      expect(() => segmentInsert.run(
        "cross-source-segmentation",
        sourceA.document.id,
        sourceB.segmentation.id,
        null,
        "unknown",
        10,
        null,
        0,
        8,
        "Source A",
        "a".repeat(64)
      )).toThrow(/foreign key/i);

      const secondSegmentationId = "00000000-0000-4000-8000-000000000032";
      database.prepare(
        `INSERT INTO source_segmentations (id, source_document_id, algorithm_version, created_at)
         VALUES (?, ?, ?, ?)`
      ).run(secondSegmentationId, sourceA.document.id, "synthetic-segmentation-v2", "2025-01-01T00:00:00.000Z");
      const parent = sourceA.segments[0];
      if (!parent) throw new Error("Expected source A to have a segment");
      expect(() => segmentInsert.run(
        "cross-segmentation-parent",
        sourceA.document.id,
        secondSegmentationId,
        parent.id,
        "unknown",
        0,
        null,
        0,
        8,
        "Source A",
        "b".repeat(64)
      )).toThrow(/foreign key/i);
    } finally {
      database.close();
    }
  });

  it("rolls back every source row when segment creation fails", () => {
    const database = openDatabase();
    try {
      const project = new ProjectRepository(database).create({ name: "Atomic source", entryMode: "import-mend" }, {
        id: "00000000-0000-4000-8000-000000000025"
      });
      const repository = new SourceRepository(database);
      database.exec("CREATE TRIGGER fail_source_segment_insert BEFORE INSERT ON source_segments BEGIN SELECT RAISE(ABORT, 'simulated source failure'); END");

      expect(() => repository.create(project.id, {
        filename: "atomic.txt",
        mediaType: "text/plain",
        encoding: "utf-8",
        text: "# Chapter 1\nWill fail"
      })).toThrow(/simulated source failure/);
      expect(database.prepare("SELECT count(*) AS count FROM source_documents").get()).toEqual({ count: 0 });
      expect(database.prepare("SELECT count(*) AS count FROM source_segmentations").get()).toEqual({ count: 0 });
      expect(database.prepare("SELECT count(*) AS count FROM source_segments").get()).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });
});

describe("numbered migrations", () => {
  it("migrates a temporary fixture copy without changing the frozen fixture", () => {
    const originalHash = fileHash(migration001FixturePath);
    const directory = temporaryDirectory();
    const databasePath = join(directory, "migration-001.sqlite");
    const migrationDirectory = join(directory, "migrations");
    mkdirSync(migrationDirectory);
    copyFileSync(migration001FixturePath, databasePath);
    copyFileSync(migration001Path, join(migrationDirectory, "001_initial.sql"));
    writeFileSync(
      join(migrationDirectory, "002_fixture_probe.sql"),
      "CREATE TABLE migration_002_probe (id INTEGER PRIMARY KEY NOT NULL, note TEXT NOT NULL);"
    );

    try {
      const database = openDatabase(databasePath, { migrationDirectory });
      try {
        expect(database.prepare("SELECT version, name FROM schema_migrations ORDER BY version").all()).toEqual([
          { version: 1, name: "initial" },
          { version: 2, name: "fixture_probe" }
        ]);
        expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'migration_002_probe'").get()).toEqual({
          name: "migration_002_probe"
        });
        expect(new ProjectRepository(database).get("00000000-0000-4000-8000-000000000001")).toMatchObject({
          name: "Frozen migration fixture",
          entryMode: "import-mend"
        });
      } finally {
        database.close();
      }

      const originalDatabase = new DatabaseSync(migration001FixturePath, { readOnly: true });
      try {
        expect(originalDatabase.prepare("SELECT version, name FROM schema_migrations ORDER BY version").all()).toEqual([
          { version: 1, name: "initial" }
        ]);
      } finally {
        originalDatabase.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
      expect(fileHash(migration001FixturePath)).toBe(originalHash);
    }
  });

  it("migrates the frozen M1-A fixture to the current schema in a temporary copy", () => {
    const directory = temporaryDirectory();
    const databasePath = join(directory, "migration-001.sqlite");
    copyFileSync(migration001FixturePath, databasePath);
    try {
      const database = openDatabase(databasePath);
      try {
        expect(database.prepare("SELECT version, name FROM schema_migrations ORDER BY version").all()).toEqual([
          { version: 1, name: "initial" },
          { version: 2, name: "source_import" }
        ]);
        expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'source_documents'").get()).toEqual({
          name: "source_documents"
        });
      } finally {
        database.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("is idempotent and records exact checksums", () => {
    const database = openDatabase();
    try {
      const rows = database.prepare("SELECT version, name, checksum FROM schema_migrations ORDER BY version").all() as Array<{
        version: number;
        name: string;
        checksum: string;
      }>;
      expect(rows.map((row) => [row.version, row.name])).toEqual([[1, "initial"], [2, "source_import"]]);
      expect(rows.every((row) => row.checksum.length === 64)).toBe(true);
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
