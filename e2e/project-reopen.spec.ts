import { test, expect } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

interface RunningServer {
  child: ChildProcess;
  baseUrl: string;
}

interface ReadyMessage {
  type: "ready";
  host: string;
  port: number;
}

function startServer(databasePath: string): Promise<RunningServer> {
  const launcherPath = join(process.cwd(), "e2e", "server-child.mjs");
  const child = spawn(process.execPath, [launcherPath], {
    env: { ...process.env, STORY_CREATOR_DATABASE_PATH: databasePath },
    stdio: ["ignore", "pipe", "pipe"]
  });

  return new Promise<RunningServer>((resolve, reject) => {
    let settled = false;
    let stdout = "";
    let stderr = "";

    const cleanup = () => {
      clearTimeout(timer);
      child.stdout?.off("data", onStdout);
      child.stderr?.off("data", onStderr);
      child.off("error", onError);
      child.off("exit", onExit);
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      child.kill();
      const details = stderr.trim();
      reject(new Error(`${error.message}${details ? `\n${details}` : ""}`));
    };

    const onStdout = (chunk: Buffer | string) => {
      stdout += chunk.toString();
      let newlineIndex = stdout.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = stdout.slice(0, newlineIndex).trim();
        stdout = stdout.slice(newlineIndex + 1);
        if (!line) {
          newlineIndex = stdout.indexOf("\n");
          continue;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          fail(new Error(`Malformed readiness message from server child: ${line}`));
          return;
        }
        if (!isReadyMessage(parsed)) {
          fail(new Error(`Malformed readiness message from server child: ${line}`));
          return;
        }
        settled = true;
        cleanup();
        resolve({ child, baseUrl: `http://${parsed.host}:${parsed.port}` });
        return;
      }
    };

    const onStderr = (chunk: Buffer | string) => {
      stderr += chunk.toString();
    };

    const onError = (error: Error) => {
      fail(new Error(`Server child failed to start: ${error.message}`));
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      const reason = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
      fail(new Error(`Server child exited before readiness (${reason})`));
    };

    const timer = setTimeout(() => {
      fail(new Error("Server child did not report readiness within 10 seconds"));
    }, 10_000);

    child.stdout?.on("data", onStdout);
    child.stderr?.on("data", onStderr);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

function isReadyMessage(value: unknown): value is ReadyMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  return message.type === "ready"
    && message.host === "127.0.0.1"
    && typeof message.port === "number"
    && Number.isInteger(message.port)
    && message.port > 0
    && message.port < 65_536;
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const onExit = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off("exit", onExit);
      resolve();
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.off("exit", onExit);
      reject(new Error(`Server process ${child.pid ?? "unknown"} did not exit within 2 seconds`));
    }, 2_000);
    child.once("exit", onExit);
    if (child.exitCode !== null) {
      onExit();
      return;
    }
    child.kill();
  });
}

test("creates, restarts, and reopens a saved project", async ({ page }) => {
  const directory = mkdtempSync(join(tmpdir(), "story-creator-e2e-"));
  const databasePath = join(directory, "story.sqlite");
  let server: RunningServer | undefined;
  try {
    server = await startServer(databasePath);
    await page.goto(server.baseUrl);
    await expect(page.getByRole("heading", { name: "Story Creator" })).toBeVisible();
    await page.getByLabel("Project name").fill("Browser restart story");
    await page.getByLabel("Import and continue").check();
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page.getByRole("heading", { name: "Browser restart story" })).toBeVisible();
    await expect(page.locator("section[aria-labelledby='selected-heading']").getByText("Import and continue", { exact: true })).toBeVisible();

    await stopServer(server.child);
    server = await startServer(databasePath);
    await page.goto(server.baseUrl);
    const savedProjects = page.locator("section[aria-labelledby='saved-heading']");
    await expect(savedProjects.getByText("Browser restart story", { exact: true })).toBeVisible();
    await savedProjects.getByRole("button", { name: "Open" }).click();
    await expect(page.getByRole("heading", { name: "Browser restart story" })).toBeVisible();
    await expect(page.getByText("Ready to reopen", { exact: true })).toBeVisible();
  } finally {
    if (server) await stopServer(server.child);
    rmSync(directory, { recursive: true, force: true });
  }
});
