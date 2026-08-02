import { z } from "zod";
import { sourceMediaTypes } from "./source.js";
import { sourceSegmentSchema } from "./source.js";

const fingerprintSchema = z.string().regex(/^[0-9a-f]{64}$/);

export const createManuscriptInputSchema = z
  .object({
    sourceDocumentId: z.string().uuid()
  })
  .strict();

export type CreateManuscriptInput = z.infer<typeof createManuscriptInputSchema>;

export function parseCreateManuscriptInput(value: unknown): CreateManuscriptInput {
  return createManuscriptInputSchema.parse(value);
}

export const saveManuscriptDraftInputSchema = z
  .object({
    prose: z.string(),
    expectedRevision: z.number().int().positive()
  })
  .strict();

export type SaveManuscriptDraftInput = z.infer<typeof saveManuscriptDraftInputSchema>;

export function parseSaveManuscriptDraftInput(value: unknown): SaveManuscriptDraftInput {
  return saveManuscriptDraftInputSchema.parse(value);
}

export const manuscriptUnitSchema = z
  .object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    sourceDocumentId: z.string().uuid().nullable(),
    sourceSegmentId: z.string().min(1).nullable(),
    position: z.number().int().nonnegative(),
    currentVersionId: z.string().uuid(),
    acceptedVersionId: z.string().uuid().nullable(),
    createdAt: z.string().min(1)
  })
  .strict();

export type ManuscriptUnit = z.infer<typeof manuscriptUnitSchema>;

export const manuscriptUnitVersionSchema = z
  .object({
    id: z.string().uuid(),
    manuscriptUnitId: z.string().uuid(),
    versionNumber: z.number().int().positive(),
    title: z.string().nullable(),
    prose: z.string(),
    fingerprint: fingerprintSchema,
    sourceDocumentId: z.string().uuid().nullable(),
    sourceSegmentId: z.string().min(1).nullable(),
    createdAt: z.string().min(1),
    restoredFromVersionId: z.string().uuid().nullable()
  })
  .strict();

export type ManuscriptUnitVersion = z.infer<typeof manuscriptUnitVersionSchema>;

export const manuscriptDraftSchema = z
  .object({
    manuscriptUnitId: z.string().uuid(),
    prose: z.string(),
    revision: z.number().int().positive(),
    fingerprint: fingerprintSchema,
    updatedAt: z.string().min(1)
  })
  .strict();

export type ManuscriptDraft = z.infer<typeof manuscriptDraftSchema>;

export const manuscriptStructureSchema = z
  .object({
    projectId: z.string().uuid(),
    sourceDocumentId: z.string().uuid(),
    revision: z.number().int().positive(),
    activeUnitIds: z.array(z.string().uuid()),
    updatedAt: z.string().min(1)
  })
  .strict();

export type ManuscriptStructure = z.infer<typeof manuscriptStructureSchema>;

export const manuscriptSourceComparisonSchema = z
  .object({
    document: z
      .object({
        id: z.string().uuid(),
        filename: z.string().min(1),
        mediaType: z.enum(sourceMediaTypes),
        encoding: z.literal("utf-8"),
        normalizedTextHash: fingerprintSchema
      })
      .strict(),
    segment: sourceSegmentSchema
  })
  .strict();

export type ManuscriptSourceComparison = z.infer<typeof manuscriptSourceComparisonSchema>;

export const manuscriptUnitViewSchema = z
  .object({
    unit: manuscriptUnitSchema,
    currentVersion: manuscriptUnitVersionSchema,
    draft: manuscriptDraftSchema,
    sourceComparison: manuscriptSourceComparisonSchema.nullable()
  })
  .strict();

export type ManuscriptUnitView = z.infer<typeof manuscriptUnitViewSchema>;

export const manuscriptViewSchema = z
  .object({
    projectId: z.string().uuid(),
    sourceDocumentId: z.string().uuid(),
    structure: manuscriptStructureSchema,
    units: z.array(manuscriptUnitViewSchema)
  })
  .strict();

export type ManuscriptView = z.infer<typeof manuscriptViewSchema>;
