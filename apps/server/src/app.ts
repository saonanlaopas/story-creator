import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { openDatabase, ProjectRepository } from "@story-creator/persistence";
import { runtimeConfig, staticRoot, type BuildAppOptions } from "./config.js";
import { registerProjectRoutes } from "./routes/project-routes.js";

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const database = openDatabase(options.databasePath ?? runtimeConfig().databasePath);
  const repository = new ProjectRepository(database);
  const app = Fastify({ logger: options.logger ?? false });

  app.addHook("onClose", async () => {
    database.close();
  });

  app.get("/api/health", async () => ({ ok: true, service: "story-creator" }));
  registerProjectRoutes(app, repository);

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
