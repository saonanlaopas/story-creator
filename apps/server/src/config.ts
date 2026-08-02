import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { StoryProvider } from "./providers/provider.js";

export interface BuildAppOptions {
  databasePath?: string;
  environment?: NodeJS.ProcessEnv;
  logger?: boolean;
  providerRunTimeoutMs?: number;
  providers?: StoryProvider[];
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

export function staticRoot(defaultPath?: string): string {
  if (defaultPath) {
    return defaultPath;
  }
  const serverDirectory = dirname(fileURLToPath(import.meta.url));
  return join(serverDirectory, "..", "..", "web", "dist");
}
