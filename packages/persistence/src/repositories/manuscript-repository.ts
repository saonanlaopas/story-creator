import { createHash, randomUUID } from "node:crypto";
import type {
  ManuscriptDraft,
  ManuscriptSourceComparison,
  ManuscriptStructure,
  ManuscriptUnit,
  ManuscriptUnitVersion,
  ManuscriptUnitView,
  ManuscriptView,
  SaveManuscriptDraftInput
} from "@story-creator/domain";
import {
  manuscriptDraftSchema,
  manuscriptSourceComparisonSchema,
  manuscriptStructureSchema,
  manuscriptUnitSchema,
  manuscriptUnitVersionSchema,
  manuscriptViewSchema,
  parseSaveManuscriptDraftInput
} from "@story-creator/domain";
import type { DatabaseSync } from "../database.js";
import { transaction } from "../database.js";
import { SourceRepository } from "./source-repository.js";

interface ManuscriptStructureRow {
  project_id: string;
  source_document_id: string;
  revision: number;
  updated_at: string;
}

interface ManuscriptViewRow {
  structure_project_id: string;
  structure_source_document_id: string;
  structure_revision: number;
  structure_updated_at: string;
  unit_id: string;
  unit_project_id: string;
  unit_source_document_id: string | null;
  unit_source_segment_id: string | null;
  unit_position: number;
  unit_current_version_id: string;
  unit_accepted_version_id: string | null;
  unit_created_at: string;
  version_id: string;
  version_unit_id: string;
  version_number: number;
  version_title: string | null;
  version_prose: string;
  version_fingerprint: string;
  version_source_document_id: string | null;
  version_source_segment_id: string | null;
  version_created_at: string;
  version_restored_from_version_id: string | null;
  draft_unit_id: string;
  draft_prose: string;
  draft_revision: number;
  draft_fingerprint: string;
  draft_updated_at: string;
  source_id: string | null;
  source_filename: string | null;
  source_media_type: "text/plain" | "text/markdown" | null;
  source_encoding: "utf-8" | null;
  source_normalized_text_hash: string | null;
  segment_id: string | null;
  segment_source_document_id: string | null;
  segment_segmentation_version_id: string | null;
  segment_parent_id: string | null;
  segment_kind: "chapter" | "scene" | "unknown" | null;
  segment_position: number | null;
  segment_heading: string | null;
  segment_start_offset: number | null;
  segment_end_offset: number | null;
  segment_content: string | null;
  segment_fingerprint: string | null;
}

interface DraftRow {
  manuscript_unit_id: string;
  prose: string;
  revision: number;
  fingerprint: string;
  updated_at: string;
}

interface CheckpointRow extends DraftRow {
  unit_project_id: string;
  unit_source_document_id: string | null;
  unit_source_segment_id: string | null;
  unit_current_version_id: string;
  unit_accepted_version_id: string | null;
  unit_position: number;
  unit_created_at: string;
  version_id: string;
  version_number: number;
  version_title: string | null;
  version_prose: string;
  version_fingerprint: string;
  version_source_document_id: string | null;
  version_source_segment_id: string | null;
  version_created_at: string;
  version_restored_from_version_id: string | null;
}

export interface InitializeManuscriptOptions {
  unitIds?: string[];
  versionIds?: string[];
  now?: Date;
}

export interface SaveManuscriptDraftOptions {
  now?: Date;
}

export interface CheckpointManuscriptUnitOptions {
  versionId?: string;
  now?: Date;
}

export interface SaveManuscriptDraftResult {
  changed: boolean;
  draft: ManuscriptDraft;
  manuscript: ManuscriptView;
}

export interface CheckpointManuscriptUnitResult {
  created: boolean;
  version: ManuscriptUnitVersion;
  manuscript: ManuscriptView;
}

export class SourceForManuscriptNotFoundError extends Error {
  public constructor() {
    super("Source document not found for this project");
    this.name = "SourceForManuscriptNotFoundError";
  }
}

export class ManuscriptNotFoundError extends Error {
  public constructor() {
    super("Manuscript not found");
    this.name = "ManuscriptNotFoundError";
  }
}

export class ManuscriptAlreadyInitializedError extends Error {
  public constructor() {
    super("A manuscript already exists for this project and source");
    this.name = "ManuscriptAlreadyInitializedError";
  }
}

export class ManuscriptUnitNotFoundError extends Error {
  public constructor() {
    super("Manuscript unit not found for this project");
    this.name = "ManuscriptUnitNotFoundError";
  }
}

export class DraftRevisionConflictError extends Error {
  public constructor(public readonly currentDraft: ManuscriptDraft) {
    super("Draft revision is stale; reload the current draft and retry");
    this.name = "DraftRevisionConflictError";
  }
}

function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function manuscriptStructureFromRow(row: ManuscriptStructureRow, activeUnitIds: string[]): ManuscriptStructure {
  return manuscriptStructureSchema.parse({
    projectId: row.project_id,
    sourceDocumentId: row.source_document_id,
    revision: row.revision,
    activeUnitIds,
    updatedAt: row.updated_at
  });
}

function manuscriptUnitFromRow(row: ManuscriptViewRow): ManuscriptUnit {
  return manuscriptUnitSchema.parse({
    id: row.unit_id,
    projectId: row.unit_project_id,
    sourceDocumentId: row.unit_source_document_id,
    sourceSegmentId: row.unit_source_segment_id,
    position: row.unit_position,
    currentVersionId: row.unit_current_version_id,
    acceptedVersionId: row.unit_accepted_version_id,
    createdAt: row.unit_created_at
  });
}

function manuscriptVersionFromRow(row: ManuscriptViewRow | CheckpointRow): ManuscriptUnitVersion {
  return manuscriptUnitVersionSchema.parse({
    id: row.version_id,
    manuscriptUnitId: "version_unit_id" in row ? row.version_unit_id : row.manuscript_unit_id,
    versionNumber: row.version_number,
    title: row.version_title,
    prose: row.version_prose,
    fingerprint: row.version_fingerprint,
    sourceDocumentId: row.version_source_document_id,
    sourceSegmentId: row.version_source_segment_id,
    createdAt: row.version_created_at,
    restoredFromVersionId: row.version_restored_from_version_id
  });
}

function manuscriptDraftFromViewRow(row: ManuscriptViewRow): ManuscriptDraft {
  return manuscriptDraftSchema.parse({
    manuscriptUnitId: row.draft_unit_id,
    prose: row.draft_prose,
    revision: row.draft_revision,
    fingerprint: row.draft_fingerprint,
    updatedAt: row.draft_updated_at
  });
}

function manuscriptDraftFromDraftRow(row: DraftRow): ManuscriptDraft {
  return manuscriptDraftSchema.parse({
    manuscriptUnitId: row.manuscript_unit_id,
    prose: row.prose,
    revision: row.revision,
    fingerprint: row.fingerprint,
    updatedAt: row.updated_at
  });
}

function sourceComparisonFromRow(row: ManuscriptViewRow): ManuscriptSourceComparison | null {
  if (
    !row.source_id
    || !row.source_filename
    || !row.source_media_type
    || !row.source_encoding
    || !row.source_normalized_text_hash
    || !row.segment_id
    || !row.segment_source_document_id
    || !row.segment_segmentation_version_id
    || !row.segment_kind
    || row.segment_position === null
    || row.segment_start_offset === null
    || row.segment_end_offset === null
    || row.segment_content === null
    || !row.segment_fingerprint
  ) {
    return null;
  }

  return manuscriptSourceComparisonSchema.parse({
    document: {
      id: row.source_id,
      filename: row.source_filename,
      mediaType: row.source_media_type,
      encoding: row.source_encoding,
      normalizedTextHash: row.source_normalized_text_hash
    },
    segment: {
      id: row.segment_id,
      sourceDocumentId: row.segment_source_document_id,
      segmentationVersionId: row.segment_segmentation_version_id,
      parentId: row.segment_parent_id,
      kind: row.segment_kind,
      position: row.segment_position,
      heading: row.segment_heading,
      startOffset: row.segment_start_offset,
      endOffset: row.segment_end_offset,
      text: row.segment_content,
      fingerprint: row.segment_fingerprint
    }
  });
}

function checkpointRowVersion(row: CheckpointRow): ManuscriptUnitVersion {
  return manuscriptUnitVersionSchema.parse({
    id: row.version_id,
    manuscriptUnitId: row.manuscript_unit_id,
    versionNumber: row.version_number,
    title: row.version_title,
    prose: row.version_prose,
    fingerprint: row.version_fingerprint,
    sourceDocumentId: row.version_source_document_id,
    sourceSegmentId: row.version_source_segment_id,
    createdAt: row.version_created_at,
    restoredFromVersionId: row.version_restored_from_version_id
  });
}

export class ManuscriptRepository {
  private readonly sourceRepository: SourceRepository;

  public constructor(
    private readonly database: DatabaseSync,
    sourceRepository = new SourceRepository(database)
  ) {
    this.sourceRepository = sourceRepository;
  }

  public initialize(
    projectId: string,
    sourceDocumentId: string,
    options: InitializeManuscriptOptions = {}
  ): ManuscriptView {
    const source = this.sourceRepository.get(projectId, sourceDocumentId);
    if (!source) {
      throw new SourceForManuscriptNotFoundError();
    }

    const existingStructure = this.database
      .prepare("SELECT project_id, source_document_id, revision, updated_at FROM manuscript_structures WHERE project_id = ?")
      .get(projectId) as unknown as ManuscriptStructureRow | undefined;
    if (existingStructure) {
      if (existingStructure.source_document_id !== sourceDocumentId) {
        throw new ManuscriptAlreadyInitializedError();
      }
      const existing = this.get(projectId);
      if (!existing) {
        throw new ManuscriptNotFoundError();
      }
      return existing;
    }

    const segments = source.segments;
    const unitIds = options.unitIds ?? segments.map(() => randomUUID());
    const versionIds = options.versionIds ?? segments.map(() => randomUUID());
    if (unitIds.length !== segments.length || versionIds.length !== segments.length) {
      throw new Error("Manuscript initialization IDs must match the source segment count");
    }
    const createdAt = (options.now ?? new Date()).toISOString();
    const structure = manuscriptStructureSchema.parse({
      projectId,
      sourceDocumentId,
      revision: 1,
      activeUnitIds: unitIds,
      updatedAt: createdAt
    });

    const rows = segments.map((segment, position) => {
      const unitId = unitIds[position];
      const versionId = versionIds[position];
      if (!unitId || !versionId) {
        throw new Error("Manuscript initialization IDs must not be empty");
      }
      const fingerprint = hashText(segment.text);
      return {
        unit: manuscriptUnitSchema.parse({
          id: unitId,
          projectId,
          sourceDocumentId,
          sourceSegmentId: segment.id,
          position,
          currentVersionId: versionId,
          acceptedVersionId: null,
          createdAt
        }),
        version: manuscriptUnitVersionSchema.parse({
          id: versionId,
          manuscriptUnitId: unitId,
          versionNumber: 1,
          title: segment.heading,
          prose: segment.text,
          fingerprint,
          sourceDocumentId,
          sourceSegmentId: segment.id,
          createdAt,
          restoredFromVersionId: null
        }),
        draft: manuscriptDraftSchema.parse({
          manuscriptUnitId: unitId,
          prose: segment.text,
          revision: 1,
          fingerprint,
          updatedAt: createdAt
        })
      };
    });

    transaction(this.database, () => {
      this.database
        .prepare(
          `INSERT INTO manuscript_structures (project_id, source_document_id, revision, updated_at)
           VALUES (?, ?, ?, ?)`
        )
        .run(structure.projectId, structure.sourceDocumentId, structure.revision, structure.updatedAt);

      for (const [position, row] of rows.entries()) {
        this.database
          .prepare(
            `INSERT INTO manuscript_units
              (id, project_id, source_document_id, source_segment_id, position, current_version_id, accepted_version_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            row.unit.id,
            row.unit.projectId,
            row.unit.sourceDocumentId,
            row.unit.sourceSegmentId,
            position,
            row.unit.currentVersionId,
            row.unit.acceptedVersionId,
            row.unit.createdAt
          );
        this.database
          .prepare(
            `INSERT INTO manuscript_unit_versions
              (id, manuscript_unit_id, version_number, title, prose, fingerprint, source_document_id, source_segment_id, created_at, restored_from_version_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            row.version.id,
            row.version.manuscriptUnitId,
            row.version.versionNumber,
            row.version.title,
            row.version.prose,
            row.version.fingerprint,
            row.version.sourceDocumentId,
            row.version.sourceSegmentId,
            row.version.createdAt,
            row.version.restoredFromVersionId
          );
        this.database
          .prepare(
            `INSERT INTO manuscript_drafts (manuscript_unit_id, prose, revision, fingerprint, updated_at)
             VALUES (?, ?, ?, ?, ?)`
          )
          .run(
            row.draft.manuscriptUnitId,
            row.draft.prose,
            row.draft.revision,
            row.draft.fingerprint,
            row.draft.updatedAt
          );
        this.database
          .prepare(
            `INSERT INTO manuscript_unit_order (project_id, position, manuscript_unit_id)
             VALUES (?, ?, ?)`
          )
          .run(projectId, position, row.unit.id);
      }
    });

    const manuscript = this.get(projectId);
    if (!manuscript) {
      throw new ManuscriptNotFoundError();
    }
    return manuscript;
  }

  public get(projectId: string): ManuscriptView | undefined {
    const structureRow = this.database
      .prepare("SELECT project_id, source_document_id, revision, updated_at FROM manuscript_structures WHERE project_id = ?")
      .get(projectId) as unknown as ManuscriptStructureRow | undefined;
    if (!structureRow) return undefined;

    const rows = this.database
      .prepare(
        `SELECT
          s.project_id AS structure_project_id,
          s.source_document_id AS structure_source_document_id,
          s.revision AS structure_revision,
          s.updated_at AS structure_updated_at,
          u.id AS unit_id,
          u.project_id AS unit_project_id,
          u.source_document_id AS unit_source_document_id,
          u.source_segment_id AS unit_source_segment_id,
          u.position AS unit_position,
          u.current_version_id AS unit_current_version_id,
          u.accepted_version_id AS unit_accepted_version_id,
          u.created_at AS unit_created_at,
          v.id AS version_id,
          v.manuscript_unit_id AS version_unit_id,
          v.version_number AS version_number,
          v.title AS version_title,
          v.prose AS version_prose,
          v.fingerprint AS version_fingerprint,
          v.source_document_id AS version_source_document_id,
          v.source_segment_id AS version_source_segment_id,
          v.created_at AS version_created_at,
          v.restored_from_version_id AS version_restored_from_version_id,
          d.manuscript_unit_id AS draft_unit_id,
          d.prose AS draft_prose,
          d.revision AS draft_revision,
          d.fingerprint AS draft_fingerprint,
          d.updated_at AS draft_updated_at,
          sd.id AS source_id,
          sd.filename AS source_filename,
          sd.media_type AS source_media_type,
          sd.encoding AS source_encoding,
          sd.normalized_text_hash AS source_normalized_text_hash,
          ss.id AS segment_id,
          ss.source_document_id AS segment_source_document_id,
          ss.segmentation_version_id AS segment_segmentation_version_id,
          ss.parent_id AS segment_parent_id,
          ss.kind AS segment_kind,
          ss.position AS segment_position,
          ss.heading AS segment_heading,
          ss.start_offset AS segment_start_offset,
          ss.end_offset AS segment_end_offset,
          ss.content AS segment_content,
          ss.fingerprint AS segment_fingerprint
         FROM manuscript_structures s
         JOIN manuscript_unit_order o ON o.project_id = s.project_id
         JOIN manuscript_units u ON u.project_id = o.project_id AND u.id = o.manuscript_unit_id
         JOIN manuscript_unit_versions v ON v.manuscript_unit_id = u.id AND v.id = u.current_version_id
         JOIN manuscript_drafts d ON d.manuscript_unit_id = u.id
         LEFT JOIN source_documents sd ON sd.id = u.source_document_id
         LEFT JOIN source_segments ss ON ss.source_document_id = u.source_document_id AND ss.id = u.source_segment_id
         WHERE s.project_id = ?
         ORDER BY o.position ASC`
      )
      .all(projectId) as unknown as ManuscriptViewRow[];
    const activeUnitIds = rows.map((row) => row.unit_id);
    const structure = manuscriptStructureFromRow(structureRow, activeUnitIds);
    const units = rows.map((row): ManuscriptUnitView => ({
      unit: manuscriptUnitFromRow(row),
      currentVersion: manuscriptVersionFromRow(row),
      draft: manuscriptDraftFromViewRow(row),
      sourceComparison: sourceComparisonFromRow(row)
    }));
    return manuscriptViewSchema.parse({
      projectId: structure.projectId,
      sourceDocumentId: structure.sourceDocumentId,
      structure,
      units
    });
  }

  public saveDraft(
    projectId: string,
    manuscriptUnitId: string,
    input: SaveManuscriptDraftInput,
    options: SaveManuscriptDraftOptions = {}
  ): SaveManuscriptDraftResult {
    const parsed = parseSaveManuscriptDraftInput(input);
    let changed = false;
    let resultDraft: ManuscriptDraft | undefined;
    transaction(this.database, () => {
      const row = this.database
        .prepare(
          `SELECT d.manuscript_unit_id, d.prose, d.revision, d.fingerprint, d.updated_at
           FROM manuscript_drafts d
           JOIN manuscript_units u ON u.id = d.manuscript_unit_id
           WHERE u.project_id = ? AND u.id = ?`
        )
        .get(projectId, manuscriptUnitId) as unknown as DraftRow | undefined;
      if (!row) {
        throw new ManuscriptUnitNotFoundError();
      }
      const currentDraft = manuscriptDraftFromDraftRow(row);
      if (currentDraft.revision !== parsed.expectedRevision) {
        throw new DraftRevisionConflictError(currentDraft);
      }
      const fingerprint = hashText(parsed.prose);
      if (currentDraft.prose === parsed.prose && currentDraft.fingerprint === fingerprint) {
        resultDraft = currentDraft;
        return;
      }
      const nextDraft = manuscriptDraftSchema.parse({
        manuscriptUnitId,
        prose: parsed.prose,
        revision: currentDraft.revision + 1,
        fingerprint,
        updatedAt: (options.now ?? new Date()).toISOString()
      });
      this.database
        .prepare(
          `UPDATE manuscript_drafts
           SET prose = ?, revision = ?, fingerprint = ?, updated_at = ?
           WHERE manuscript_unit_id = ? AND revision = ?`
        )
        .run(
          nextDraft.prose,
          nextDraft.revision,
          nextDraft.fingerprint,
          nextDraft.updatedAt,
          nextDraft.manuscriptUnitId,
          currentDraft.revision
        );
      changed = true;
      resultDraft = nextDraft;
    });

    if (!resultDraft) {
      throw new Error("Draft save did not produce a result");
    }
    const manuscript = this.get(projectId);
    if (!manuscript) {
      throw new ManuscriptNotFoundError();
    }
    return { changed, draft: resultDraft, manuscript };
  }

  public checkpoint(
    projectId: string,
    manuscriptUnitId: string,
    options: CheckpointManuscriptUnitOptions = {}
  ): CheckpointManuscriptUnitResult {
    let created = false;
    let resultVersion: ManuscriptUnitVersion | undefined;
    transaction(this.database, () => {
      const row = this.database
        .prepare(
          `SELECT
            u.project_id AS unit_project_id,
            u.source_document_id AS unit_source_document_id,
            u.source_segment_id AS unit_source_segment_id,
            u.current_version_id AS unit_current_version_id,
            u.accepted_version_id AS unit_accepted_version_id,
            u.position AS unit_position,
            u.created_at AS unit_created_at,
            d.manuscript_unit_id,
            d.prose,
            d.revision,
            d.fingerprint,
            d.updated_at,
            v.id AS version_id,
            v.version_number,
            v.title AS version_title,
            v.prose AS version_prose,
            v.fingerprint AS version_fingerprint,
            v.source_document_id AS version_source_document_id,
            v.source_segment_id AS version_source_segment_id,
            v.created_at AS version_created_at,
            v.restored_from_version_id AS version_restored_from_version_id
           FROM manuscript_units u
           JOIN manuscript_drafts d ON d.manuscript_unit_id = u.id
           JOIN manuscript_unit_versions v ON v.manuscript_unit_id = u.id AND v.id = u.current_version_id
           WHERE u.project_id = ? AND u.id = ?`
        )
        .get(projectId, manuscriptUnitId) as unknown as CheckpointRow | undefined;
      if (!row) {
        throw new ManuscriptUnitNotFoundError();
      }
      const currentVersion = checkpointRowVersion(row);
      const draftFingerprint = hashText(row.prose);
      if (currentVersion.prose === row.prose && currentVersion.fingerprint === draftFingerprint) {
        resultVersion = currentVersion;
        return;
      }

      const maxVersionRow = this.database
        .prepare("SELECT max(version_number) AS max_version FROM manuscript_unit_versions WHERE manuscript_unit_id = ?")
        .get(manuscriptUnitId) as unknown as { max_version: number | null };
      const version = manuscriptUnitVersionSchema.parse({
        id: options.versionId ?? randomUUID(),
        manuscriptUnitId,
        versionNumber: (maxVersionRow.max_version ?? 0) + 1,
        title: currentVersion.title,
        prose: row.prose,
        fingerprint: draftFingerprint,
        sourceDocumentId: row.unit_source_document_id,
        sourceSegmentId: row.unit_source_segment_id,
        createdAt: (options.now ?? new Date()).toISOString(),
        restoredFromVersionId: null
      });
      this.database
        .prepare(
          `INSERT INTO manuscript_unit_versions
            (id, manuscript_unit_id, version_number, title, prose, fingerprint, source_document_id, source_segment_id, created_at, restored_from_version_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          version.id,
          version.manuscriptUnitId,
          version.versionNumber,
          version.title,
          version.prose,
          version.fingerprint,
          version.sourceDocumentId,
          version.sourceSegmentId,
          version.createdAt,
          version.restoredFromVersionId
        );
      this.database
        .prepare("UPDATE manuscript_units SET current_version_id = ? WHERE project_id = ? AND id = ?")
        .run(version.id, projectId, manuscriptUnitId);
      created = true;
      resultVersion = version;
    });

    if (!resultVersion) {
      throw new Error("Manuscript checkpoint did not produce a version");
    }
    const manuscript = this.get(projectId);
    if (!manuscript) {
      throw new ManuscriptNotFoundError();
    }
    return { created, version: resultVersion, manuscript };
  }
}
