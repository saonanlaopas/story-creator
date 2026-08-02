import type {
  CreateManuscriptInput,
  ManuscriptDraft,
  ManuscriptUnitVersion,
  ManuscriptView,
  SaveManuscriptDraftInput
} from "@story-creator/domain";
import { request } from "./api.js";

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

export function loadManuscript(projectId: string): Promise<ManuscriptView | null> {
  return request<ManuscriptView | null>(`/api/projects/${projectId}/manuscript`);
}

export function initializeManuscript(projectId: string, input: CreateManuscriptInput): Promise<ManuscriptView> {
  return request<ManuscriptView>(`/api/projects/${projectId}/manuscript`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function saveManuscriptDraft(
  projectId: string,
  unitId: string,
  input: SaveManuscriptDraftInput
): Promise<SaveManuscriptDraftResult> {
  return request<SaveManuscriptDraftResult>(`/api/projects/${projectId}/manuscript/units/${unitId}/draft`, {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export function checkpointManuscriptUnit(projectId: string, unitId: string): Promise<CheckpointManuscriptUnitResult> {
  return request<CheckpointManuscriptUnitResult>(`/api/projects/${projectId}/manuscript/units/${unitId}/checkpoint`, {
    method: "POST",
    body: JSON.stringify({})
  });
}
