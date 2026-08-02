import { test, expect } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
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

function startServer(databasePath: string, port = 0): Promise<RunningServer> {
  const launcherPath = join(process.cwd(), "e2e", "server-child.mjs");
  const child = spawn(process.execPath, [launcherPath], {
    env: { ...process.env, STORY_CREATOR_DATABASE_PATH: databasePath, STORY_CREATOR_E2E_PORT: String(port) },
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

function findAvailablePort(): Promise<number> {
  const probe = createNetServer();
  return new Promise<number>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        probe.close();
        reject(new Error("Could not reserve an available loopback port"));
        return;
      }
      probe.close((error) => error ? reject(error) : resolve(address.port));
    });
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

test("imports, inspects, restarts, and reopens an immutable source outline", async ({ page }) => {
  const directory = mkdtempSync(join(tmpdir(), "story-creator-source-e2e-"));
  const databasePath = join(directory, "story.sqlite");
  const port = await findAvailablePort();
  let server: RunningServer | undefined;
  try {
    server = await startServer(databasePath, port);
    await page.goto(server.baseUrl);
    await page.getByLabel("Project name").fill("Browser source story");
    await page.getByLabel("Import and mend").check();
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page.getByRole("heading", { name: "Story source" })).toBeVisible();

    const markdownText = "# Chapter One\nOpening \u2014 \u65e5\u672c\u8a9e \u{1F642}\n## Arrival\nA ship arrives.";
    await page.getByLabel("UTF-8 TXT or Markdown file").setInputFiles({
      name: "browser-story.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(markdownText, "utf8")
    });
    await expect(page.getByLabel("Paste source text")).toHaveValue(markdownText);
    await page.getByRole("button", { name: "Import source" }).click();
    await expect(page.getByRole("heading", { name: "browser-story.md" })).toBeVisible();
    await expect(page.getByTestId("normalized-source")).toContainText("A ship arrives.");
    await page.getByRole("button", { name: /Arrival/ }).click();
    await expect(page.getByTestId("selected-source-segment")).toContainText("A ship arrives.");

    await stopServer(server.child);
    server = await startServer(databasePath, port);
    await page.goto(server.baseUrl);
    await expect(page.getByRole("heading", { name: "Browser source story" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "browser-story.md" })).toBeVisible();
    await expect(page.getByTestId("selected-source-segment")).toContainText("A ship arrives.");
  } finally {
    if (server) await stopServer(server.child);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects invalid source files without creating source rows", async ({ page }) => {
  const directory = mkdtempSync(join(tmpdir(), "story-creator-invalid-source-e2e-"));
  const databasePath = join(directory, "story.sqlite");
  let server: RunningServer | undefined;
  let projectId = "";
  let sourcePostCount = 0;
  try {
    server = await startServer(databasePath);
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (request.method() === "POST" && /\/api\/projects\/[^/]+\/sources$/.test(pathname)) {
        sourcePostCount += 1;
      }
    });
    await page.goto(server.baseUrl);
    await page.getByLabel("Project name").fill("Invalid source story");
    const projectResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === "POST" && url.pathname === "/api/projects";
    });
    await page.getByRole("button", { name: "Create project" }).click();
    projectId = (await (await projectResponsePromise).json()).id as string;
    await expect(page.getByRole("heading", { name: "Story source" })).toBeVisible();

    const invalidFiles = [
      {
        name: "story.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("not a supported source", "utf8"),
        message: /unsupported source file.*\.txt.*\.md.*\.markdown/i
      },
      {
        name: "story.md",
        mimeType: "text/plain",
        buffer: Buffer.from("Markdown with an incompatible MIME", "utf8"),
        message: /incompatible MIME/i
      },
      {
        name: "story.txt",
        mimeType: "text/plain",
        buffer: Buffer.from([0xc3, 0x28]),
        message: /invalid UTF-8.*save.*UTF-8/i
      }
    ];

    for (const invalidFile of invalidFiles) {
      await page.getByLabel("UTF-8 TXT or Markdown file").setInputFiles(invalidFile);
      await expect(page.getByRole("alert")).toContainText(invalidFile.message);
      await expect(page.getByLabel("Paste source text")).toHaveValue("");
      await page.getByRole("button", { name: "Import source" }).click();
      await expect(page.getByText("No source imported yet.", { exact: true })).toBeVisible();
      const sources = await page.request.get(`${server.baseUrl}/api/projects/${projectId}/sources`);
      expect(sources.ok()).toBeTruthy();
      expect(await sources.json()).toEqual([]);
    }

    expect(sourcePostCount).toBe(0);

    const validUnicodeText = "Caf\u00e9 \u2014 \u65e5\u672c\u8a9e \u{1F642}";
    await page.getByLabel("UTF-8 TXT or Markdown file").setInputFiles({
      name: "valid.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(validUnicodeText, "utf8")
    });
    await expect(page.getByLabel("Paste source text")).toHaveValue(validUnicodeText);
    await page.getByRole("button", { name: "Import source" }).click();
    await expect(page.getByTestId("normalized-source")).toContainText(validUnicodeText);
    expect(sourcePostCount).toBe(1);
  } finally {
    if (server) await stopServer(server.child);
    rmSync(directory, { recursive: true, force: true });
  }
});
