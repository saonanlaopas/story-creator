import { describe, expect, it } from "vitest";
import { buildApp } from "../src/index.js";

describe("server API", () => {
  it("serves health and project create/list/get routes", async () => {
    const app = await buildApp({ databasePath: ":memory:" });
    try {
      const health = await app.inject({ method: "GET", url: "/api/health" });
      expect(health.statusCode).toBe(200);
      expect(health.json()).toEqual({ ok: true, service: "story-creator" });

      const invalid = await app.inject({
        method: "POST",
        url: "/api/projects",
        payload: { name: "", entryMode: "premise" }
      });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json().error).toMatch(/name/i);

      const created = await app.inject({
        method: "POST",
        url: "/api/projects",
        payload: { name: " API project ", entryMode: "import-continue" }
      });
      expect(created.statusCode).toBe(201);
      expect(created.json()).toMatchObject({ name: "API project", entryMode: "import-continue", status: "active" });

      const list = await app.inject({ method: "GET", url: "/api/projects" });
      expect(list.statusCode).toBe(200);
      expect(list.json()).toHaveLength(1);
      const projectId = created.json().id as string;
      const get = await app.inject({ method: "GET", url: `/api/projects/${projectId}` });
      expect(get.statusCode).toBe(200);
      expect(get.json().id).toBe(projectId);
      const missing = await app.inject({ method: "GET", url: "/api/projects/missing" });
      expect(missing.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("reopens a file database through a new app instance", async () => {
    const path = `${process.cwd()}\\test-reopen-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`;
    const first = await buildApp({ databasePath: path });
    let projectId: string;
    try {
      const response = await first.inject({
        method: "POST",
        url: "/api/projects",
        payload: { name: "Reopen me", entryMode: "premise" }
      });
      projectId = response.json().id as string;
    } finally {
      await first.close();
    }
    const second = await buildApp({ databasePath: path });
    try {
      const response = await second.inject({ method: "GET", url: `/api/projects/${projectId!}` });
      expect(response.statusCode).toBe(200);
      expect(response.json().name).toBe("Reopen me");
    } finally {
      await second.close();
      const { rmSync } = await import("node:fs");
      rmSync(path, { force: true });
    }
  });

  it("imports an immutable source and exposes its read-only outline", async () => {
    const app = await buildApp({ databasePath: ":memory:" });
    try {
      const created = await app.inject({
        method: "POST",
        url: "/api/projects",
        payload: { name: "Source API project", entryMode: "import-mend" }
      });
      const projectId = created.json().id as string;
      const imported = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/sources`,
        payload: {
          filename: "api-story.md",
          mediaType: "text/markdown",
          encoding: "utf-8",
          text: "# First\nOpening\n## Scene\nArrival"
        }
      });
      expect(imported.statusCode).toBe(201);
      expect(imported.json()).toMatchObject({
        document: {
          projectId,
          filename: "api-story.md",
          mediaType: "text/markdown",
          normalizedText: "# First\nOpening\n## Scene\nArrival"
        },
        segmentation: { algorithmVersion: "source-segmentation-v1" }
      });
      const sourceId = imported.json().document.id as string;
      const listed = await app.inject({ method: "GET", url: `/api/projects/${projectId}/sources` });
      expect(listed.statusCode).toBe(200);
      expect(listed.json()).toHaveLength(1);
      const read = await app.inject({ method: "GET", url: `/api/projects/${projectId}/sources/${sourceId}` });
      expect(read.statusCode).toBe(200);
      expect(read.json().segments).toHaveLength(2);
      const update = await app.inject({
        method: "PUT",
        url: `/api/projects/${projectId}/sources/${sourceId}`,
        payload: { text: "Changed" }
      });
      expect(update.statusCode).toBe(409);
      expect(update.json().error).toMatch(/immutable/i);

      const otherProject = await app.inject({
        method: "POST",
        url: "/api/projects",
        payload: { name: "Other source API project", entryMode: "import-mend" }
      });
      const otherProjectId = otherProject.json().id as string;
      const wrongOwner = await app.inject({ method: "GET", url: `/api/projects/${otherProjectId}/sources/${sourceId}` });
      expect(wrongOwner.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
