import { buildApp } from "../apps/server/dist/index.js";
import process from "node:process";

const app = await buildApp();
await app.listen({ host: "127.0.0.1", port: 0 });
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
