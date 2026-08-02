import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import type * as Sqlite from "node:sqlite";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DraftRevisionConflictError,
  ManuscriptRepository,
  openDatabase,
  ProjectRepository,
  readMigrations,
  SourceRepository,
  transaction
} from "../src/index.js";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof Sqlite;

function temporaryDirectory(): string {
  return mkdtempSync(join(tmpdir(), "story-creator-test-"));
}

const migration001FixturePath = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "migration-001.sqlite");
const migration002FixturePath = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "migration-002.sqlite");
const migration003FixturePath = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "migration-003.sqlite");
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

describe("autosaved working manuscript", () => {
  it("creates one ordered unit, version, and draft per source segment without changing source", () => {
    const database = openDatabase();
    try {
      const project = new ProjectRepository(database).create({ name: "Manuscript project", entryMode: "import-mend" }, {
        id: "00000000-0000-4000-8000-000000000040"
      });
      const sources = new SourceRepository(database);
      const source = sources.create(project.id, {
        filename: "manuscript.md",
        mediaType: "text/markdown",
        encoding: "utf-8",
        text: "# First\nAlpha\n## Second\nBravo\n---\nCharlie"
      }, {
        id: "00000000-0000-4000-8000-000000000041",
        segmentationVersionId: "00000000-0000-4000-8000-000000000042"
      });
      const sourceBefore = sources.get(project.id, source.document.id);
      const repository = new ManuscriptRepository(database);
      const unitIds = [
        "00000000-0000-4000-8000-000000000043",
        "00000000-0000-4000-8000-000000000044",
        "00000000-0000-4000-8000-000000000045"
      ];
      const versionIds = [
        "00000000-0000-4000-8000-000000000046",
        "00000000-0000-4000-8000-000000000047",
        "00000000-0000-4000-8000-000000000048"
      ];
      const manuscript = repository.initialize(project.id, source.document.id, {
        unitIds,
        versionIds,
        now: new Date("2025-01-03T00:00:00.000Z")
      });

      expect(manuscript.structure).toMatchObject({
        projectId: project.id,
        sourceDocumentId: source.document.id,
        revision: 1,
        activeUnitIds: unitIds
      });
      expect(manuscript.units).toHaveLength(source.segments.length);
      manuscript.units.forEach((unit, position) => {
        const sourceSegment = source.segments[position];
        expect(sourceSegment).toBeDefined();
        expect(unit.unit).toMatchObject({
          id: unitIds[position],
          projectId: project.id,
          sourceDocumentId: source.document.id,
          sourceSegmentId: sourceSegment?.id,
          position,
          currentVersionId: versionIds[position],
          acceptedVersionId: null
        });
        expect(unit.currentVersion).toMatchObject({
          id: versionIds[position],
          manuscriptUnitId: unitIds[position],
          versionNumber: 1,
          title: sourceSegment?.heading,
          prose: sourceSegment?.text,
          sourceDocumentId: source.document.id,
          sourceSegmentId: sourceSegment?.id
        });
        expect(unit.draft).toMatchObject({
          manuscriptUnitId: unitIds[position],
          prose: sourceSegment?.text,
          revision: 1,
          fingerprint: unit.currentVersion.fingerprint
        });
        expect(unit.sourceComparison?.segment.id).toBe(sourceSegment?.id);
      });
      expect(sources.get(project.id, source.document.id)).toEqual(sourceBefore);
      expect(repository.get(project.id)).toEqual(manuscript);
    } finally {
      database.close();
    }
  });

  it("keeps the accepted empty-source behavior by creating one empty unit", () => {
    const database = openDatabase();
    try {
      const project = new ProjectRepository(database).create({ name: "Empty manuscript", entryMode: "import-mend" }, {
        id: "00000000-0000-4000-8000-000000000050"
      });
      const source = new SourceRepository(database).create(project.id, {
        filename: "empty.txt",
        mediaType: "text/plain",
        encoding: "utf-8",
        text: ""
      });
      const manuscript = new ManuscriptRepository(database).initialize(project.id, source.document.id);
      expect(manuscript.units).toHaveLength(1);
      expect(manuscript.units[0]?.draft.prose).toBe("");
      expect(manuscript.units[0]?.unit.position).toBe(0);
    } finally {
      database.close();
    }
  });

  it("rolls back all manuscript rows after a later initial-creation write fails", () => {
    const database = openDatabase();
    try {
      const project = new ProjectRepository(database).create({ name: "Rollback manuscript", entryMode: "import-mend" }, {
        id: "00000000-0000-4000-8000-000000000060"
      });
      const source = new SourceRepository(database).create(project.id, {
        filename: "rollback.md",
        mediaType: "text/markdown",
        encoding: "utf-8",
        text: "# One\nfirst\n# Two\nsecond"
      });
      const before = new SourceRepository(database).get(project.id, source.document.id);
      const unitIds = [
        "00000000-0000-4000-8000-000000000061",
        "00000000-0000-4000-8000-000000000062"
      ];
      database.exec(
        `CREATE TRIGGER fail_second_manuscript_draft
         BEFORE INSERT ON manuscript_drafts
         WHEN NEW.manuscript_unit_id = '${unitIds[1]}'
         BEGIN SELECT RAISE(ABORT, 'simulated manuscript creation failure'); END`
      );
      expect(() => new ManuscriptRepository(database).initialize(project.id, source.document.id, {
        unitIds,
        versionIds: [
          "00000000-0000-4000-8000-000000000063",
          "00000000-0000-4000-8000-000000000064"
        ]
      })).toThrow(/simulated manuscript creation failure/);
      for (const table of ["manuscript_structures", "manuscript_units", "manuscript_unit_versions", "manuscript_drafts", "manuscript_unit_order"]) {
        expect(database.prepare(`SELECT count(*) AS count FROM ${table}`).get()).toEqual({ count: 0 });
      }
      expect(new SourceRepository(database).get(project.id, source.document.id)).toEqual(before);
    } finally {
      database.close();
    }
  });

  it("saves material drafts, preserves stable IDs, keeps structure revision, and reuses no-op checkpoints", () => {
    const database = openDatabase();
    try {
      const project = new ProjectRepository(database).create({ name: "Draft manuscript", entryMode: "import-mend" }, {
        id: "00000000-0000-4000-8000-000000000070"
      });
      const source = new SourceRepository(database).create(project.id, {
        filename: "draft.txt",
        mediaType: "text/plain",
        encoding: "utf-8",
        text: "Original prose"
      });
      const repository = new ManuscriptRepository(database);
      const initial = repository.initialize(project.id, source.document.id, {
        unitIds: ["00000000-0000-4000-8000-000000000071"],
        versionIds: ["00000000-0000-4000-8000-000000000072"]
      });
      const unit = initial.units[0];
      if (!unit) throw new Error("Expected one manuscript unit");
      const saved = repository.saveDraft(project.id, unit.unit.id, {
        prose: "Edited prose",
        expectedRevision: 1
      }, { now: new Date("2025-01-04T00:00:00.000Z") });
      expect(saved.changed).toBe(true);
      expect(saved.draft).toMatchObject({ prose: "Edited prose", revision: 2 });
      expect(saved.draft.fingerprint).not.toBe(unit.draft.fingerprint);
      expect(saved.manuscript.structure.revision).toBe(1);
      expect(saved.manuscript.units[0]?.unit.id).toBe(unit.unit.id);
      expect(saved.manuscript.units[0]?.currentVersion.id).toBe(unit.currentVersion.id);
      expect(database.prepare("SELECT count(*) AS count FROM manuscript_unit_versions WHERE manuscript_unit_id = ?").get(unit.unit.id)).toEqual({ count: 1 });

      const noOp = repository.saveDraft(project.id, unit.unit.id, {
        prose: "Edited prose",
        expectedRevision: 2
      });
      expect(noOp.changed).toBe(false);
      expect(noOp.draft).toEqual(saved.draft);
      expect(database.prepare("SELECT count(*) AS count FROM manuscript_unit_versions WHERE manuscript_unit_id = ?").get(unit.unit.id)).toEqual({ count: 1 });

      const checkpoint = repository.checkpoint(project.id, unit.unit.id, {
        versionId: "00000000-0000-4000-8000-000000000073",
        now: new Date("2025-01-05T00:00:00.000Z")
      });
      expect(checkpoint.created).toBe(true);
      expect(checkpoint.version).toMatchObject({
        id: "00000000-0000-4000-8000-000000000073",
        versionNumber: 2,
        prose: "Edited prose"
      });
      expect(checkpoint.manuscript.units[0]?.unit.currentVersionId).toBe(checkpoint.version.id);
      expect(checkpoint.manuscript.units[0]?.unit.acceptedVersionId).toBeNull();

      const repeated = repository.checkpoint(project.id, unit.unit.id);
      expect(repeated.created).toBe(false);
      expect(repeated.version.id).toBe(checkpoint.version.id);
      expect(database.prepare("SELECT count(*) AS count FROM manuscript_unit_versions WHERE manuscript_unit_id = ?").get(unit.unit.id)).toEqual({ count: 2 });

      database.prepare("UPDATE manuscript_units SET accepted_version_id = ? WHERE id = ?").run(unit.currentVersion.id, unit.unit.id);
      const savedAfterAcceptedPointer = repository.saveDraft(project.id, unit.unit.id, {
        prose: "Final prose",
        expectedRevision: 2
      });
      const nextCheckpoint = repository.checkpoint(project.id, unit.unit.id);
      expect(savedAfterAcceptedPointer.manuscript.structure.revision).toBe(1);
      expect(nextCheckpoint.manuscript.units[0]?.unit.currentVersionId).not.toBe(unit.currentVersion.id);
      expect(nextCheckpoint.manuscript.units[0]?.unit.acceptedVersionId).toBe(unit.currentVersion.id);
    } finally {
      database.close();
    }
  });

  it("rejects stale and failed saves without replacing the persisted draft", () => {
    const database = openDatabase();
    try {
      const project = new ProjectRepository(database).create({ name: "Conflict manuscript", entryMode: "import-mend" }, {
        id: "00000000-0000-4000-8000-000000000080"
      });
      const source = new SourceRepository(database).create(project.id, {
        filename: "conflict.txt",
        mediaType: "text/plain",
        encoding: "utf-8",
        text: "Persisted"
      });
      const repository = new ManuscriptRepository(database);
      const manuscript = repository.initialize(project.id, source.document.id);
      const unit = manuscript.units[0];
      if (!unit) throw new Error("Expected one manuscript unit");
      const saved = repository.saveDraft(project.id, unit.unit.id, { prose: "First edit", expectedRevision: 1 });
      expect(() => repository.saveDraft(project.id, unit.unit.id, { prose: "Stale edit", expectedRevision: 1 })).toThrow(DraftRevisionConflictError);
      try {
        repository.saveDraft(project.id, unit.unit.id, { prose: "Stale edit", expectedRevision: 1 });
      } catch (error) {
        expect(error).toBeInstanceOf(DraftRevisionConflictError);
        if (error instanceof DraftRevisionConflictError) {
          expect(error.currentDraft).toEqual(saved.draft);
        }
      }
      database.exec("CREATE TRIGGER fail_manuscript_draft_update BEFORE UPDATE ON manuscript_drafts BEGIN SELECT RAISE(ABORT, 'simulated draft save failure'); END");
      expect(() => repository.saveDraft(project.id, unit.unit.id, { prose: "Failed edit", expectedRevision: 2 })).toThrow(/simulated draft save failure/);
      expect(repository.get(project.id)?.units[0]?.draft).toEqual(saved.draft);
    } finally {
      database.close();
    }
  });

  it("enforces ownership, immutable version updates, and project cascade cleanup", () => {
    const database = openDatabase();
    try {
      const projects = new ProjectRepository(database);
      const owner = projects.create({ name: "Manuscript owner", entryMode: "import-mend" }, {
        id: "00000000-0000-4000-8000-000000000090"
      });
      const other = projects.create({ name: "Other manuscript owner", entryMode: "import-mend" }, {
        id: "00000000-0000-4000-8000-000000000091"
      });
      const sources = new SourceRepository(database);
      const source = sources.create(owner.id, {
        filename: "owned.txt",
        mediaType: "text/plain",
        encoding: "utf-8",
        text: "Owned"
      });
      const repository = new ManuscriptRepository(database);
      const manuscript = repository.initialize(owner.id, source.document.id);
      const unit = manuscript.units[0];
      if (!unit) throw new Error("Expected one manuscript unit");
      expect(repository.get(other.id)).toBeUndefined();
      expect(() => repository.saveDraft(other.id, unit.unit.id, { prose: "Cross owner", expectedRevision: 1 })).toThrow(/not found/i);
      expect(() => database.prepare("UPDATE manuscript_unit_versions SET prose = ? WHERE id = ?").run("Changed", unit.currentVersion.id)).toThrow(/immutable/i);
      expect(repository.get(owner.id)?.units[0]?.currentVersion.prose).toBe("Owned");

      database.prepare("DELETE FROM projects WHERE id = ?").run(owner.id);
      expect(repository.get(owner.id)).toBeUndefined();
      for (const table of ["manuscript_structures", "manuscript_units", "manuscript_unit_versions", "manuscript_drafts", "manuscript_unit_order"]) {
        expect(database.prepare(`SELECT count(*) AS count FROM ${table}`).get()).toEqual({ count: 0 });
      }
      expect(projects.get(other.id)?.name).toBe("Other manuscript owner");
    } finally {
      database.close();
    }
  });

  it("derives active positions only from manuscript order and retains inactive history", () => {
    const database = openDatabase();
    try {
      const project = new ProjectRepository(database).create({ name: "Ordered manuscript", entryMode: "import-mend" }, {
        id: "00000000-0000-4000-8000-000000000100"
      });
      const source = new SourceRepository(database).create(project.id, {
        filename: "ordered.txt",
        mediaType: "text/plain",
        encoding: "utf-8",
        text: "# First\nFirst prose\n# Second\nSecond prose"
      });
      const unitIds = [
        "00000000-0000-4000-8000-000000000101",
        "00000000-0000-4000-8000-000000000102"
      ];
      const versionIds = [
        "00000000-0000-4000-8000-000000000103",
        "00000000-0000-4000-8000-000000000104"
      ];
      const repository = new ManuscriptRepository(database);
      const initial = repository.initialize(project.id, source.document.id, { unitIds, versionIds });
      const firstUnit = initial.units[0];
      const secondUnit = initial.units[1];
      if (!firstUnit || !secondUnit) throw new Error("Expected two manuscript units");

      const unitColumns = database.prepare("PRAGMA table_info(manuscript_units)").all() as Array<{ name: string }>;
      expect(unitColumns.some((column) => column.name === "position")).toBe(false);

      database.prepare("DELETE FROM manuscript_unit_order WHERE project_id = ?").run(project.id);
      database.prepare("INSERT INTO manuscript_unit_order (project_id, position, manuscript_unit_id) VALUES (?, ?, ?)").run(project.id, 0, secondUnit.unit.id);
      database.prepare("INSERT INTO manuscript_unit_order (project_id, position, manuscript_unit_id) VALUES (?, ?, ?)").run(project.id, 1, firstUnit.unit.id);
      const reordered = repository.get(project.id);
      expect(reordered?.units.map((unit) => ({ id: unit.unit.id, position: unit.unit.position }))).toEqual([
        { id: secondUnit.unit.id, position: 0 },
        { id: firstUnit.unit.id, position: 1 }
      ]);

      database.prepare("DELETE FROM manuscript_unit_order WHERE project_id = ?").run(project.id);
      database.prepare("INSERT INTO manuscript_unit_order (project_id, position, manuscript_unit_id) VALUES (?, ?, ?)").run(project.id, 0, firstUnit.unit.id);
      database.prepare("INSERT INTO manuscript_unit_order (project_id, position, manuscript_unit_id) VALUES (?, ?, ?)").run(project.id, 1, secondUnit.unit.id);
      database.prepare("DELETE FROM manuscript_unit_order WHERE project_id = ? AND manuscript_unit_id = ?").run(project.id, firstUnit.unit.id);
      database.prepare("DELETE FROM manuscript_unit_order WHERE project_id = ? AND manuscript_unit_id = ?").run(project.id, secondUnit.unit.id);
      database.prepare("INSERT INTO manuscript_unit_order (project_id, position, manuscript_unit_id) VALUES (?, ?, ?)").run(project.id, 0, secondUnit.unit.id);

      const active = repository.get(project.id);
      expect(active?.structure.activeUnitIds).toEqual([secondUnit.unit.id]);
      expect(active?.units.map((unit) => ({ id: unit.unit.id, position: unit.unit.position }))).toEqual([
        { id: secondUnit.unit.id, position: 0 }
      ]);
      expect(database.prepare("SELECT count(*) AS count FROM manuscript_units WHERE id = ?").get(firstUnit.unit.id)).toEqual({ count: 1 });
      expect(database.prepare("SELECT count(*) AS count FROM manuscript_unit_versions WHERE id = ? AND manuscript_unit_id = ?").get(firstUnit.currentVersion.id, firstUnit.unit.id)).toEqual({ count: 1 });
      expect(database.prepare("SELECT count(*) AS count FROM manuscript_drafts WHERE manuscript_unit_id = ?").get(firstUnit.unit.id)).toEqual({ count: 1 });
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
          { version: 2, name: "source_import" },
          { version: 3, name: "manuscript" },
          { version: 4, name: "provider_runs" }
        ]);
        expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'source_documents'").get()).toEqual({
          name: "source_documents"
        });
        expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'manuscript_units'").get()).toEqual({
          name: "manuscript_units"
        });
        expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'provider_runs'").get()).toEqual({
          name: "provider_runs"
        });
      } finally {
        database.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("migrates a frozen M1-B1 fixture in a temporary copy and preserves source rows", () => {
    const originalHash = fileHash(migration002FixturePath);
    const originalDatabase = new DatabaseSync(migration002FixturePath, { readOnly: true });
    const sourceDocumentsBefore = originalDatabase
      .prepare("SELECT * FROM source_documents ORDER BY id")
      .all();
    const sourceSegmentationsBefore = originalDatabase
      .prepare("SELECT * FROM source_segmentations ORDER BY id")
      .all();
    const sourceSegmentsBefore = originalDatabase
      .prepare("SELECT * FROM source_segments ORDER BY source_document_id, position")
      .all();
    originalDatabase.close();

    const directory = temporaryDirectory();
    const databasePath = join(directory, "migration-002.sqlite");
    copyFileSync(migration002FixturePath, databasePath);
    try {
      const database = openDatabase(databasePath);
      try {
        expect(database.prepare("SELECT version, name FROM schema_migrations ORDER BY version").all()).toEqual([
          { version: 1, name: "initial" },
          { version: 2, name: "source_import" },
          { version: 3, name: "manuscript" },
          { version: 4, name: "provider_runs" }
        ]);
        expect(database.prepare("SELECT * FROM source_documents ORDER BY id").all()).toEqual(sourceDocumentsBefore);
        expect(database.prepare("SELECT * FROM source_segmentations ORDER BY id").all()).toEqual(sourceSegmentationsBefore);
        expect(database.prepare("SELECT * FROM source_segments ORDER BY source_document_id, position").all()).toEqual(sourceSegmentsBefore);
      } finally {
        database.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
      expect(fileHash(migration002FixturePath)).toBe(originalHash);
    }
  });

  it("migrates the frozen M1-B2 fixture and preserves manuscript drafts and versions", () => {
    const originalHash = fileHash(migration003FixturePath);
    const originalDatabase = new DatabaseSync(migration003FixturePath, { readOnly: true });
    const projectBefore = originalDatabase.prepare("SELECT * FROM projects ORDER BY id").all();
    const structuresBefore = originalDatabase.prepare("SELECT * FROM manuscript_structures ORDER BY project_id").all();
    const unitsBefore = originalDatabase.prepare("SELECT * FROM manuscript_units ORDER BY id").all();
    const versionsBefore = originalDatabase.prepare("SELECT * FROM manuscript_unit_versions ORDER BY id").all();
    const draftsBefore = originalDatabase.prepare("SELECT * FROM manuscript_drafts ORDER BY manuscript_unit_id").all();
    const orderBefore = originalDatabase.prepare("SELECT * FROM manuscript_unit_order ORDER BY project_id, position").all();
    originalDatabase.close();

    const directory = temporaryDirectory();
    const databasePath = join(directory, "migration-003.sqlite");
    copyFileSync(migration003FixturePath, databasePath);
    try {
      const database = openDatabase(databasePath);
      try {
        expect(database.prepare("SELECT version, name FROM schema_migrations ORDER BY version").all()).toEqual([
          { version: 1, name: "initial" },
          { version: 2, name: "source_import" },
          { version: 3, name: "manuscript" },
          { version: 4, name: "provider_runs" }
        ]);
        expect(database.prepare("SELECT * FROM projects ORDER BY id").all()).toEqual(projectBefore);
        expect(database.prepare("SELECT * FROM manuscript_structures ORDER BY project_id").all()).toEqual(structuresBefore);
        expect(database.prepare("SELECT * FROM manuscript_units ORDER BY id").all()).toEqual(unitsBefore);
        expect(database.prepare("SELECT * FROM manuscript_unit_versions ORDER BY id").all()).toEqual(versionsBefore);
        expect(database.prepare("SELECT * FROM manuscript_drafts ORDER BY manuscript_unit_id").all()).toEqual(draftsBefore);
        expect(database.prepare("SELECT * FROM manuscript_unit_order ORDER BY project_id, position").all()).toEqual(orderBefore);
        expect(database.prepare("SELECT count(*) AS count FROM provider_runs").get()).toEqual({ count: 0 });
      } finally {
        database.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
      expect(fileHash(migration003FixturePath)).toBe(originalHash);
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
      expect(rows.map((row) => [row.version, row.name])).toEqual([
        [1, "initial"],
        [2, "source_import"],
        [3, "manuscript"],
        [4, "provider_runs"]
      ]);
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
