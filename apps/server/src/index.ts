import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";
import { parseCreateProjectInput } from "@story-creator/domain";
import { openDatabase, ProjectRepository } from "@story-creator/persistence";

export interface BuildAppOptions {
  databasePath?: string;
  logger?: boolean;
  webDistPath?: string;
}

export interface ServerConfig {
  host: "127.0.0.1";
  port: number;
  databasePath: string;
}

export function runtimeConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const configuredPort = Number(env.STORY_CREATOR_PORT ?? "3001");
  const port = Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort < 65_536 ? configuredPort : 3001;
  return {
    host: "127.0.0.1",
    port,
    databasePath: env.STORY_CREATOR_DATABASE_PATH ?? join(process.cwd(), "data", "story-creator.sqlite")
  };
}

function staticRoot(defaultPath?: string): string {
  if (defaultPath) {
    return defaultPath;
  }
  const serverDirectory = dirname(fileURLToPath(import.meta.url));
  return join(serverDirectory, "..", "..", "web", "dist");
}

function readableValidationError(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues.map((issue) => `${issue.path.join(".") || "request"}: ${issue.message}`).join("; ");
  }
  return error instanceof Error ? error.message : "Invalid request";
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const database = openDatabase(options.databasePath ?? runtimeConfig().databasePath);
  const repository = new ProjectRepository(database);
  const app = Fastify({ logger: options.logger ?? false });

  app.addHook("onClose", async () => {
    database.close();
  });

  app.get("/api/health", async () => ({ ok: true, service: "story-creator" }));

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

  const webRoot = staticRoot(options.webDistPath);
  if (existsSync(webRoot)) {
    await app.register(fastifyStatic, {
      root: webRoot,
      wildcard: false,
      index: "index.html"
    });
    app.setNotFoundHandler(async (request, reply) => {
      if (request.method === "GET" && !request.url.startsWith("/api/")) {
        return reply.sendFile("index.html");
      }
      return reply.code(404).send({ error: "Not found" });
    });
  }

  return app;
}

export async function startServer(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = await buildApp(options);
  const config = runtimeConfig();
  await app.listen({ host: config.host, port: config.port });
  return app;
}
