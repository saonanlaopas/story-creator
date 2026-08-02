import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { ManuscriptRepository, openDatabase, ProjectRepository, ProviderRunRepository, SourceRepository } from "@story-creator/persistence";
import { runtimeConfig, staticRoot, type BuildAppOptions } from "./config.js";
import { registerProjectRoutes } from "./routes/project-routes.js";
import { registerSourceRoutes } from "./routes/source-routes.js";
import { registerManuscriptRoutes } from "./routes/manuscript-routes.js";
import { registerProviderRunRoutes } from "./routes/provider-run-routes.js";
import { FakeProvider } from "./providers/fake-provider.js";
import { OpenRouterProvider } from "./providers/openrouter-provider.js";
import type { StoryProvider } from "./providers/provider.js";
import { ProviderRunService } from "./services/provider-run-service.js";

function configuredProviders(options: BuildAppOptions): StoryProvider[] {
  if (options.providers) return options.providers;
  const providers: StoryProvider[] = [new FakeProvider()];
  const apiKey = (options.environment ?? process.env).OPENROUTER_API_KEY;
  if (apiKey) providers.push(new OpenRouterProvider({ apiKey }));
  return providers;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const database = openDatabase(options.databasePath ?? runtimeConfig().databasePath);
  const repository = new ProjectRepository(database);
  const sourceRepository = new SourceRepository(database);
  const providerRunService = new ProviderRunService(
    new ProviderRunRepository(database),
    configuredProviders(options),
    { timeoutMs: options.providerRunTimeoutMs }
  );
  providerRunService.recoverInterruptedRuns();
  const app = Fastify({ logger: options.logger ?? false });

  app.addHook("onClose", async () => {
    database.close();
  });

  app.get("/api/health", async () => ({ ok: true, service: "story-creator" }));
  registerProjectRoutes(app, repository);
  registerSourceRoutes(app, sourceRepository);
  registerManuscriptRoutes(app, new ManuscriptRepository(database, sourceRepository), repository);
  registerProviderRunRoutes(app, providerRunService, repository);

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
