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
});
