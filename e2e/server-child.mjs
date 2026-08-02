import { buildApp } from "../apps/server/dist/index.js";
import process from "node:process";

const app = await buildApp();
const configuredPort = Number(process.env.STORY_CREATOR_E2E_PORT ?? "0");
const port = Number.isInteger(configuredPort) && configuredPort >= 0 && configuredPort < 65_536 ? configuredPort : 0;
await app.listen({ host: "127.0.0.1", port });
const address = app.server.address();
if (!address || typeof address === "string") {
  await app.close();
  throw new Error("Server did not expose a loopback address after listen");
}

process.stdout.write(`${JSON.stringify({ type: "ready", host: "127.0.0.1", port: address.port })}\n`);

const shutdown = async () => {
  await app.close();
};
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
