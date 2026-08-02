import type { FastifyInstance } from "fastify";
import type { SourceImportInput } from "@story-creator/domain";
import type { SourceRepository } from "@story-creator/persistence";
import { readableValidationError } from "./project-routes.js";

interface ProjectParams {
  projectId: string;
}

interface SourceParams extends ProjectParams {
  sourceId: string;
}

export function registerSourceRoutes(app: FastifyInstance, repository: SourceRepository): void {
  app.post<{ Params: ProjectParams; Body: SourceImportInput }>("/api/projects/:projectId/sources", async (request, reply) => {
    try {
      const source = repository.create(request.params.projectId, request.body);
      return reply.code(201).send(source);
    } catch (error) {
      return reply.code(400).send({ error: readableValidationError(error) });
    }
  });

  app.get<{ Params: ProjectParams }>("/api/projects/:projectId/sources", async (request) => (
    repository.list(request.params.projectId)
  ));

  app.get<{ Params: SourceParams }>("/api/projects/:projectId/sources/:sourceId", async (request, reply) => {
    const source = repository.get(request.params.projectId, request.params.sourceId);
    if (!source) {
      return reply.code(404).send({ error: "Source document not found" });
    }
    return source;
  });

  app.put<{ Params: SourceParams }>("/api/projects/:projectId/sources/:sourceId", async (_request, reply) => (
    reply.code(409).send({ error: "Source documents are immutable" })
  ));
}
