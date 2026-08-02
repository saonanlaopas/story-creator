import { createHash, randomUUID } from "node:crypto";
import type {
  SourceDocument,
  SourceImportInput,
  SourceInspection,
  SourceSegment,
  SourceSegmentationVersion
} from "@story-creator/domain";
import {
  normalizeSourceText,
  parseSourceImportInput,
  segmentNormalizedSource,
  sourceDocumentSchema,
  sourceSegmentationAlgorithmVersion,
  sourceSegmentationVersionSchema,
  sourceSegmentSchema
} from "@story-creator/domain";
import type { DatabaseSync } from "../database.js";
import { transaction } from "../database.js";

interface SourceDocumentRow {
  id: string;
  project_id: string;
  filename: string;
  media_type: SourceDocument["mediaType"];
  encoding: "utf-8";
  content_hash: string;
  normalized_text_hash: string;
  normalized_text: string;
  warnings_json: string;
  created_at: string;
}

interface SourceSegmentationRow {
  id: string;
  source_document_id: string;
  algorithm_version: string;
  created_at: string;
}

interface SourceSegmentRow {
  id: string;
  source_document_id: string;
  segmentation_version_id: string;
  parent_id: string | null;
  kind: SourceSegment["kind"];
  position: number;
  heading: string | null;
  start_offset: number;
  end_offset: number;
  content: string;
  fingerprint: string;
}

export interface CreateSourceOptions {
  id?: string;
  segmentationVersionId?: string;
  now?: Date;
}

export class ImmutableSourceError extends Error {
  public constructor() {
    super("Source documents are immutable");
    this.name = "ImmutableSourceError";
  }
}

function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function sourceDocumentFromRow(row: SourceDocumentRow): SourceDocument {
  const warnings = JSON.parse(row.warnings_json) as unknown;
  return sourceDocumentSchema.parse({
    id: row.id,
    projectId: row.project_id,
    filename: row.filename,
    mediaType: row.media_type,
    encoding: row.encoding,
    contentHash: row.content_hash,
    normalizedTextHash: row.normalized_text_hash,
    normalizedText: row.normalized_text,
    warnings,
    createdAt: row.created_at
  });
}

function sourceSegmentationFromRow(row: SourceSegmentationRow): SourceSegmentationVersion {
  return sourceSegmentationVersionSchema.parse({
    id: row.id,
    sourceDocumentId: row.source_document_id,
    algorithmVersion: row.algorithm_version,
    createdAt: row.created_at
  });
}

function sourceSegmentFromRow(row: SourceSegmentRow): SourceSegment {
  return sourceSegmentSchema.parse({
    id: row.id,
    sourceDocumentId: row.source_document_id,
    segmentationVersionId: row.segmentation_version_id,
    parentId: row.parent_id,
    kind: row.kind,
    position: row.position,
    heading: row.heading,
    startOffset: row.start_offset,
    endOffset: row.end_offset,
    text: row.content,
    fingerprint: row.fingerprint
  });
}

function deterministicSegmentId(normalizedTextHash: string, segment: SourceSegment["kind"], position: number, startOffset: number, endOffset: number, fingerprint: string): string {
  return `segment-${hashText(`${sourceSegmentationAlgorithmVersion}\u0000${normalizedTextHash}\u0000${segment}\u0000${position}\u0000${startOffset}\u0000${endOffset}\u0000${fingerprint}`)}`;
}

export class SourceRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public create(projectId: string, input: SourceImportInput, options: CreateSourceOptions = {}): SourceInspection {
    const parsed = parseSourceImportInput(input);
    const normalizedText = normalizeSourceText(parsed.text);
    const contentHash = hashText(parsed.text);
    const normalizedTextHash = hashText(normalizedText);
    const segmentationDraft = segmentNormalizedSource(normalizedText);
    const sourceDocumentId = options.id ?? randomUUID();
    const segmentationVersionId = options.segmentationVersionId ?? randomUUID();
    const createdAt = (options.now ?? new Date()).toISOString();
    const segmentIds = segmentationDraft.segments.map((segment, position) => (
      deterministicSegmentId(
        normalizedTextHash,
        segment.kind,
        position,
        segment.startOffset,
        segment.endOffset,
        hashText(segment.text)
      )
    ));
    const document = sourceDocumentSchema.parse({
      id: sourceDocumentId,
      projectId,
      filename: parsed.filename,
      mediaType: parsed.mediaType,
      encoding: parsed.encoding,
      contentHash,
      normalizedTextHash,
      normalizedText,
      warnings: segmentationDraft.warnings,
      createdAt
    });
    const segmentation = sourceSegmentationVersionSchema.parse({
      id: segmentationVersionId,
      sourceDocumentId,
      algorithmVersion: sourceSegmentationAlgorithmVersion,
      createdAt
    });
    const segments = segmentationDraft.segments.map((segment, position) => sourceSegmentSchema.parse({
      id: segmentIds[position],
      sourceDocumentId,
      segmentationVersionId,
      parentId: segment.parentIndex === null ? null : segmentIds[segment.parentIndex],
      kind: segment.kind,
      position,
      heading: segment.heading,
      startOffset: segment.startOffset,
      endOffset: segment.endOffset,
      text: segment.text,
      fingerprint: hashText(segment.text)
    }));

    transaction(this.database, () => {
      this.database
        .prepare(
          `INSERT INTO source_documents
            (id, project_id, filename, media_type, encoding, content_hash, normalized_text_hash, normalized_text, warnings_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          document.id,
          document.projectId,
          document.filename,
          document.mediaType,
          document.encoding,
          document.contentHash,
          document.normalizedTextHash,
          document.normalizedText,
          JSON.stringify(document.warnings),
          document.createdAt
        );
      this.database
        .prepare(
          `INSERT INTO source_segmentations
            (id, source_document_id, algorithm_version, created_at)
           VALUES (?, ?, ?, ?)`
        )
        .run(segmentation.id, segmentation.sourceDocumentId, segmentation.algorithmVersion, segmentation.createdAt);
      for (const segment of segments) {
        this.database
          .prepare(
            `INSERT INTO source_segments
              (id, source_document_id, segmentation_version_id, parent_id, kind, position, heading, start_offset, end_offset, content, fingerprint)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            segment.id,
            segment.sourceDocumentId,
            segment.segmentationVersionId,
            segment.parentId,
            segment.kind,
            segment.position,
            segment.heading,
            segment.startOffset,
            segment.endOffset,
            segment.text,
            segment.fingerprint
          );
      }
    });

    return { document, segmentation, segments };
  }

  public get(projectId: string, sourceDocumentId: string): SourceInspection | undefined {
    const documentRow = this.database
      .prepare(
        `SELECT id, project_id, filename, media_type, encoding, content_hash, normalized_text_hash, normalized_text, warnings_json, created_at
         FROM source_documents WHERE project_id = ? AND id = ?`
      )
      .get(projectId, sourceDocumentId) as unknown as SourceDocumentRow | undefined;
    return documentRow ? this.readInspection(documentRow) : undefined;
  }

  public list(projectId: string): SourceInspection[] {
    const rows = this.database
      .prepare("SELECT id, project_id, filename, media_type, encoding, content_hash, normalized_text_hash, normalized_text, warnings_json, created_at FROM source_documents WHERE project_id = ? ORDER BY created_at DESC, id ASC")
      .all(projectId) as unknown as SourceDocumentRow[];
    return rows.map((row) => this.readInspection(row));
  }

  public update(): never {
    throw new ImmutableSourceError();
  }

  private readInspection(documentRow: SourceDocumentRow): SourceInspection {
    const segmentationRow = this.database
      .prepare(
        "SELECT id, source_document_id, algorithm_version, created_at FROM source_segmentations WHERE source_document_id = ? ORDER BY created_at DESC, id ASC LIMIT 1"
      )
      .get(documentRow.id) as unknown as SourceSegmentationRow | undefined;
    if (!segmentationRow) {
      throw new Error(`Source segmentation missing for ${documentRow.id}`);
    }
    const segmentRows = this.database
      .prepare(
        "SELECT id, source_document_id, segmentation_version_id, parent_id, kind, position, heading, start_offset, end_offset, content, fingerprint FROM source_segments WHERE segmentation_version_id = ? ORDER BY position ASC"
      )
      .all(segmentationRow.id) as unknown as SourceSegmentRow[];
    return {
      document: sourceDocumentFromRow(documentRow),
      segmentation: sourceSegmentationFromRow(segmentationRow),
      segments: segmentRows.map(sourceSegmentFromRow)
    };
  }
}
