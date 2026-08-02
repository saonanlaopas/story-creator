import type { FastifyInstance } from "fastify";
import {
  DraftRevisionConflictError,
  ManuscriptAlreadyInitializedError,
  ManuscriptUnitNotFoundError,
  SourceForManuscriptNotFoundError,
  type ManuscriptRepository,
  type ProjectRepository
} from "@story-creator/persistence";
import {
  parseCreateManuscriptInput,
  parseSaveManuscriptDraftInput
} from "@story-creator/domain";
import { readableValidationError } from "./project-routes.js";

interface ProjectParams {
  projectId: string;
}

interface UnitParams extends ProjectParams {
  unitId: string;
}

export function registerManuscriptRoutes(
  app: FastifyInstance,
  repository: ManuscriptRepository,
  projects: ProjectRepository
): void {
  app.post<{ Params: ProjectParams; Body: unknown }>("/api/projects/:projectId/manuscript", async (request, reply) => {
    if (!projects.get(request.params.projectId)) {
      return reply.code(404).send({ error: "Project not found" });
    }
    try {
      const input = parseCreateManuscriptInput(request.body);
      return reply.code(201).send(repository.initialize(request.params.projectId, input.sourceDocumentId));
    } catch (error) {
      if (error instanceof SourceForManuscriptNotFoundError) {
        return reply.code(404).send({ error: error.message });
      }
      if (error instanceof ManuscriptAlreadyInitializedError) {
        return reply.code(409).send({ error: error.message });
      }
      return reply.code(400).send({ error: readableValidationError(error) });
    }
  });

  app.get<{ Params: ProjectParams }>("/api/projects/:projectId/manuscript", async (request, reply) => {
    if (!projects.get(request.params.projectId)) {
      return reply.code(404).send({ error: "Project not found" });
    }
    return repository.get(request.params.projectId) ?? null;
  });

  app.put<{ Params: UnitParams; Body: unknown }>("/api/projects/:projectId/manuscript/units/:unitId/draft", async (request, reply) => {
    try {
      const input = parseSaveManuscriptDraftInput(request.body);
      return repository.saveDraft(request.params.projectId, request.params.unitId, input);
    } catch (error) {
      if (error instanceof DraftRevisionConflictError) {
        return reply.code(409).send({
          error: error.message,
          code: "DRAFT_REVISION_CONFLICT",
          currentDraft: error.currentDraft
        });
      }
      if (error instanceof ManuscriptUnitNotFoundError) {
        return reply.code(404).send({ error: error.message });
      }
      return reply.code(400).send({ error: readableValidationError(error) });
    }
  });

  app.post<{ Params: UnitParams }>("/api/projects/:projectId/manuscript/units/:unitId/checkpoint", async (request, reply) => {
    try {
      return reply.code(201).send(repository.checkpoint(request.params.projectId, request.params.unitId));
    } catch (error) {
      if (error instanceof ManuscriptUnitNotFoundError) {
        return reply.code(404).send({ error: error.message });
      }
      return reply.code(400).send({ error: readableValidationError(error) });
    }
  });

  app.get<{ Params: UnitParams }>("/api/projects/:projectId/manuscript/units/:unitId/source", async (request, reply) => {
    if (!projects.get(request.params.projectId)) {
      return reply.code(404).send({ error: "Project not found" });
    }
    const manuscript = repository.get(request.params.projectId);
    const unit = manuscript?.units.find((candidate) => candidate.unit.id === request.params.unitId);
    if (!unit) {
      return reply.code(404).send({ error: "Manuscript unit not found for this project" });
    }
    if (!unit.sourceComparison) {
      return reply.code(404).send({ error: "Source comparison not available" });
    }
    return unit.sourceComparison;
  });
}
