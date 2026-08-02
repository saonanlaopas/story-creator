import { startServer } from "./index.js";

const app = await startServer();

const shutdown = async (): Promise<void> => {
  await app.close();
};

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
