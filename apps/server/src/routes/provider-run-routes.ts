import type { FastifyInstance } from "fastify";
import { parseCreateProviderRunInput } from "@story-creator/domain";
import {
  ProviderRunNotFoundError,
  ProviderRunStateError,
  type ProjectRepository
} from "@story-creator/persistence";
import type { ProviderRunService } from "../services/provider-run-service.js";
import { readableValidationError } from "./project-routes.js";

interface ProjectParams {
  projectId: string;
}

interface RunParams extends ProjectParams {
  runId: string;
}

function providerRunError(error: unknown, reply: { code(statusCode: number): { send(body: unknown): unknown } }): unknown {
  if (error instanceof ProviderRunNotFoundError) {
    return reply.code(404).send({ error: error.message });
  }
  if (error instanceof ProviderRunStateError) {
    return reply.code(409).send({ error: error.message, code: "PROVIDER_RUN_STATE_CONFLICT" });
  }
  return reply.code(400).send({ error: readableValidationError(error) });
}

export function registerProviderRunRoutes(
  app: FastifyInstance,
  service: ProviderRunService,
  projects: ProjectRepository
): void {
  app.post<{ Params: ProjectParams; Body: unknown }>("/api/projects/:projectId/provider-runs", async (request, reply) => {
    if (!projects.get(request.params.projectId)) {
      return reply.code(404).send({ error: "Project not found" });
    }
    try {
      return reply.code(201).send(service.create(
        request.params.projectId,
        parseCreateProviderRunInput(request.body)
      ));
    } catch (error) {
      return providerRunError(error, reply);
    }
  });

  app.get<{ Params: ProjectParams }>("/api/projects/:projectId/provider-runs", async (request, reply) => {
    if (!projects.get(request.params.projectId)) {
      return reply.code(404).send({ error: "Project not found" });
    }
    return service.list(request.params.projectId);
  });

  app.get<{ Params: RunParams }>("/api/projects/:projectId/provider-runs/:runId", async (request, reply) => {
    if (!projects.get(request.params.projectId)) {
      return reply.code(404).send({ error: "Project not found" });
    }
    const detail = service.get(request.params.projectId, request.params.runId);
    return detail ?? reply.code(404).send({ error: "Provider run not found for this project" });
  });

  app.post<{ Params: RunParams }>("/api/projects/:projectId/provider-runs/:runId/execute", async (request, reply) => {
    try {
      return await service.execute(request.params.projectId, request.params.runId);
    } catch (error) {
      return providerRunError(error, reply);
    }
  });

  app.post<{ Params: RunParams }>("/api/projects/:projectId/provider-runs/:runId/cancel", async (request, reply) => {
    try {
      return service.cancel(request.params.projectId, request.params.runId);
    } catch (error) {
      return providerRunError(error, reply);
    }
  });

  app.post<{ Params: RunParams }>("/api/projects/:projectId/provider-runs/:runId/retry", async (request, reply) => {
    try {
      return reply.code(201).send(service.createRetry(request.params.projectId, request.params.runId));
    } catch (error) {
      return providerRunError(error, reply);
    }
  });
}
