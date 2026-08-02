import { z } from "zod";

export const sourceMediaTypes = ["text/plain", "text/markdown"] as const;
export type SourceMediaType = (typeof sourceMediaTypes)[number];

export const sourceEncoding = "utf-8" as const;
export const sourceSegmentationAlgorithmVersion = "source-segmentation-v1" as const;
export const sourceSegmentKinds = ["chapter", "scene", "unknown"] as const;
export type SourceSegmentKind = (typeof sourceSegmentKinds)[number];

export const sourceImportInputSchema = z
  .object({
    filename: z.string().trim().min(1, "Source filename must not be empty"),
    mediaType: z.enum(sourceMediaTypes),
    encoding: z.literal(sourceEncoding),
    text: z.string()
  })
  .strict();

export type SourceImportInput = z.infer<typeof sourceImportInputSchema>;

export function parseSourceImportInput(value: unknown): SourceImportInput {
  return sourceImportInputSchema.parse(value);
}

export const sourceDocumentSchema = z
  .object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    filename: z.string().trim().min(1),
    mediaType: z.enum(sourceMediaTypes),
    encoding: z.literal(sourceEncoding),
    contentHash: z.string().regex(/^[0-9a-f]{64}$/),
    normalizedTextHash: z.string().regex(/^[0-9a-f]{64}$/),
    normalizedText: z.string(),
    warnings: z.array(z.string()),
    createdAt: z.string().min(1)
  })
  .strict();

export type SourceDocument = z.infer<typeof sourceDocumentSchema>;

export const sourceSegmentationVersionSchema = z
  .object({
    id: z.string().uuid(),
    sourceDocumentId: z.string().uuid(),
    algorithmVersion: z.literal(sourceSegmentationAlgorithmVersion),
    createdAt: z.string().min(1)
  })
  .strict();

export type SourceSegmentationVersion = z.infer<typeof sourceSegmentationVersionSchema>;

export const sourceSegmentSchema = z
  .object({
    id: z.string().min(1),
    sourceDocumentId: z.string().uuid(),
    segmentationVersionId: z.string().uuid(),
    parentId: z.string().min(1).nullable(),
    kind: z.enum(sourceSegmentKinds),
    position: z.number().int().nonnegative(),
    heading: z.string().nullable(),
    startOffset: z.number().int().nonnegative(),
    endOffset: z.number().int().nonnegative(),
    text: z.string(),
    fingerprint: z.string().regex(/^[0-9a-f]{64}$/)
  })
  .strict();

export type SourceSegment = z.infer<typeof sourceSegmentSchema>;

export interface SourceInspection {
  document: SourceDocument;
  segmentation: SourceSegmentationVersion;
  segments: SourceSegment[];
}

export interface SourceSegmentDraft {
  kind: SourceSegmentKind;
  parentIndex: number | null;
  heading: string | null;
  startOffset: number;
  endOffset: number;
  text: string;
}

export interface SourceSegmentationDraft {
  warnings: string[];
  segments: SourceSegmentDraft[];
}

/**
 * Source offsets are UTF-16 code-unit offsets. They are therefore safe to pass
 * across the TypeScript browser/server boundary and to use with String.slice().
 */
export function normalizeSourceText(text: string): string {
  const withoutBom = text.startsWith("\uFEFF") ? text.slice(1) : text;
  return withoutBom.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

interface SourceBoundary {
  kind: Exclude<SourceSegmentKind, "unknown">;
  parentIndex: number | null;
  heading: string | null;
  startOffset: number;
}

function plainTextChapterHeading(trimmedLine: string): string | null {
  // Version 1 recognizes "Chapter 1", "Chapter I", and "Chapter One",
  // optionally followed by a title separated by whitespace, ':', '-', or '.'.
  const match = /^chapter\s+(?:\d+|[ivxlcdm]+|[a-z]+)(?:(?:\s+|\s*[:.-]\s*).*)?$/i.exec(trimmedLine);
  return match ? trimmedLine : null;
}

function boundaryForLine(trimmedLine: string): Omit<SourceBoundary, "parentIndex" | "startOffset"> | null {
  if (trimmedLine === "***" || trimmedLine === "---" || trimmedLine === "#") {
    return { kind: "scene", heading: null };
  }

  const markdownHeading = /^(#{1,2})[ \t]+(.+)$/.exec(trimmedLine);
  if (markdownHeading) {
    const marker = markdownHeading[1];
    const heading = markdownHeading[2];
    if (!marker || !heading) return null;
    return {
      kind: marker.length === 1 ? "chapter" : "scene",
      heading: heading.trim()
    };
  }

  const plainChapterHeading = plainTextChapterHeading(trimmedLine);
  return plainChapterHeading ? { kind: "chapter", heading: plainChapterHeading } : null;
}

function isAmbiguousHeadingLikeLine(trimmedLine: string): boolean {
  if (!trimmedLine) {
    return false;
  }
  if (/^#{1,2}(?:\S|$)/.test(trimmedLine) || /^#{3,}/.test(trimmedLine)) {
    return true;
  }
  return /^(?:chapter|part|act)\b/i.test(trimmedLine);
}

/**
 * Segment normalized text with Source Segmentation Algorithm Version 1.
 * Markdown H1 starts a chapter, H2 starts a scene, recognized plain-text
 * Chapter headings start chapters, and standalone *** / --- / # lines start
 * scenes. Unsupported heading-like lines remain in prose and produce warnings.
 */
export function segmentNormalizedSource(normalizedText: string): SourceSegmentationDraft {
  const boundaries: SourceBoundary[] = [];
  const warnings: string[] = [];
  const lines = normalizedText.split("\n");
  let lineStartOffset = 0;
  let currentChapterIndex: number | null = null;

  lines.forEach((line, lineIndex) => {
    const trimmedLine = line.trim();
    const boundary = boundaryForLine(trimmedLine);
    if (boundary) {
      const boundaryIndex = boundaries.length;
      boundaries.push({
        ...boundary,
        parentIndex: boundary.kind === "scene" ? currentChapterIndex : null,
        startOffset: lineStartOffset
      });
      if (boundary.kind === "chapter") {
        currentChapterIndex = boundaryIndex;
      }
    } else if (isAmbiguousHeadingLikeLine(trimmedLine)) {
      warnings.push(`Ambiguous heading-like line at UTF-16 offset ${lineStartOffset}; preserved as prose.`);
    }

    lineStartOffset += line.length;
    if (lineIndex < lines.length - 1) {
      lineStartOffset += 1;
    }
  });

  if (boundaries.length === 0) {
    return {
      warnings,
      segments: [{
        kind: "unknown",
        parentIndex: null,
        heading: null,
        startOffset: 0,
        endOffset: normalizedText.length,
        text: normalizedText
      }]
    };
  }

  const segments: SourceSegmentDraft[] = [];
  const firstBoundary = boundaries[0];
  if (firstBoundary && firstBoundary.startOffset > 0) {
    segments.push({
      kind: "unknown",
      parentIndex: null,
      heading: null,
      startOffset: 0,
      endOffset: firstBoundary.startOffset,
      text: normalizedText.slice(0, firstBoundary.startOffset)
    });
  }

  boundaries.forEach((boundary, index) => {
    const nextBoundary = boundaries[index + 1];
    const endOffset = nextBoundary?.startOffset ?? normalizedText.length;
    segments.push({
      kind: boundary.kind,
      parentIndex: boundary.parentIndex === null ? null : boundary.parentIndex + (firstBoundary?.startOffset ? 1 : 0),
      heading: boundary.heading,
      startOffset: boundary.startOffset,
      endOffset,
      text: normalizedText.slice(boundary.startOffset, endOffset)
    });
  });

  return { warnings, segments };
}
