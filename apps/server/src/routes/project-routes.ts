import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { parseCreateProjectInput } from "@story-creator/domain";
import type { ProjectRepository } from "@story-creator/persistence";

export function readableValidationError(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues.map((issue) => `${issue.path.join(".") || "request"}: ${issue.message}`).join("; ");
  }
  return error instanceof Error ? error.message : "Invalid request";
}

export function registerProjectRoutes(app: FastifyInstance, repository: ProjectRepository): void {
  app.post("/api/projects", async (request, reply) => {
    try {
      const project = repository.create(parseCreateProjectInput(request.body));
      return reply.code(201).send(project);
    } catch (error) {
      return reply.code(400).send({ error: readableValidationError(error) });
    }
  });

  app.get("/api/projects", async () => repository.list());

  app.get<{ Params: { projectId: string } }>("/api/projects/:projectId", async (request, reply) => {
    const project = repository.get(request.params.projectId);
    if (!project) {
      return reply.code(404).send({ error: "Project not found" });
    }
    return project;
  });
}
