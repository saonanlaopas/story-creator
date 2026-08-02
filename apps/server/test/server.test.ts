import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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

  it("creates, autosaves, checkpoints, and enforces manuscript ownership", async () => {
    const app = await buildApp({ databasePath: ":memory:" });
    try {
      const created = await app.inject({
        method: "POST",
        url: "/api/projects",
        payload: { name: "Manuscript API project", entryMode: "import-mend" }
      });
      const projectId = created.json().id as string;
      const otherProjectResponse = await app.inject({
        method: "POST",
        url: "/api/projects",
        payload: { name: "Other manuscript API project", entryMode: "import-mend" }
      });
      const otherProjectId = otherProjectResponse.json().id as string;
      const imported = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/sources`,
        payload: {
          filename: "manuscript-api.md",
          mediaType: "text/markdown",
          encoding: "utf-8",
          text: "# First\nOriginal first\n## Second\nOriginal second"
        }
      });
      const source = imported.json();
      const sourceDocumentId = source.document.id as string;
      const beforeSource = (await app.inject({ method: "GET", url: `/api/projects/${projectId}/sources/${sourceDocumentId}` })).json();

      const invalidInitialization = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/manuscript`,
        payload: { sourceDocumentId: "00000000-0000-4000-8000-000000000999" }
      });
      expect(invalidInitialization.statusCode).toBe(404);
      expect((await app.inject({ method: "GET", url: `/api/projects/${projectId}/manuscript` })).json()).toBeNull();

      const wrongOwnerInitialization = await app.inject({
        method: "POST",
        url: `/api/projects/${otherProjectId}/manuscript`,
        payload: { sourceDocumentId }
      });
      expect(wrongOwnerInitialization.statusCode).toBe(404);

      const initialized = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/manuscript`,
        payload: { sourceDocumentId }
      });
      expect(initialized.statusCode).toBe(201);
      expect(initialized.json().units).toHaveLength(2);
      expect(initialized.json().structure).toMatchObject({ revision: 1 });
      const unitId = initialized.json().units[0].unit.id as string;
      expect(initialized.json().units[0].sourceComparison.segment.text).toBe("# First\nOriginal first\n");

      const loaded = await app.inject({ method: "GET", url: `/api/projects/${projectId}/manuscript` });
      expect(loaded.statusCode).toBe(200);
      expect(loaded.json().units[0].draft.revision).toBe(1);
      const comparison = await app.inject({ method: "GET", url: `/api/projects/${projectId}/manuscript/units/${unitId}/source` });
      expect(comparison.statusCode).toBe(200);
      expect(comparison.json().segment.text).toBe("# First\nOriginal first\n");

      const saved = await app.inject({
        method: "PUT",
        url: `/api/projects/${projectId}/manuscript/units/${unitId}/draft`,
        payload: { prose: "Edited first", expectedRevision: 1 }
      });
      expect(saved.statusCode).toBe(200);
      expect(saved.json()).toMatchObject({ changed: true, draft: { prose: "Edited first", revision: 2 } });
      expect(saved.json().manuscript.structure.revision).toBe(1);

      const noOp = await app.inject({
        method: "PUT",
        url: `/api/projects/${projectId}/manuscript/units/${unitId}/draft`,
        payload: { prose: "Edited first", expectedRevision: 2 }
      });
      expect(noOp.statusCode).toBe(200);
      expect(noOp.json()).toMatchObject({ changed: false, draft: { revision: 2 } });

      const stale = await app.inject({
        method: "PUT",
        url: `/api/projects/${projectId}/manuscript/units/${unitId}/draft`,
        payload: { prose: "Stale first", expectedRevision: 1 }
      });
      expect(stale.statusCode).toBe(409);
      expect(stale.json()).toMatchObject({ code: "DRAFT_REVISION_CONFLICT", currentDraft: { revision: 2, prose: "Edited first" } });

      const checkpoint = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/manuscript/units/${unitId}/checkpoint`
      });
      expect(checkpoint.statusCode).toBe(201);
      expect(checkpoint.json()).toMatchObject({ created: true, version: { versionNumber: 2, prose: "Edited first" } });
      expect(checkpoint.json().manuscript.units[0].unit.acceptedVersionId).toBeNull();
      const repeatedCheckpoint = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/manuscript/units/${unitId}/checkpoint`
      });
      expect(repeatedCheckpoint.statusCode).toBe(201);
      expect(repeatedCheckpoint.json().created).toBe(false);
      expect(repeatedCheckpoint.json().version.id).toBe(checkpoint.json().version.id);

      const afterSource = (await app.inject({ method: "GET", url: `/api/projects/${projectId}/sources/${sourceDocumentId}` })).json();
      expect(afterSource).toEqual(beforeSource);
    } finally {
      await app.close();
    }
  });

  it("reopens the persisted manuscript and draft after a server restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "story-creator-manuscript-server-"));
    const databasePath = join(directory, "story.sqlite");
    const first = await buildApp({ databasePath });
    let projectId = "";
    let unitId = "";
    try {
      const project = await first.inject({
        method: "POST",
        url: "/api/projects",
        payload: { name: "Restart manuscript", entryMode: "import-mend" }
      });
      projectId = project.json().id as string;
      const source = await first.inject({
        method: "POST",
        url: `/api/projects/${projectId}/sources`,
        payload: {
          filename: "restart.md",
          mediaType: "text/markdown",
          encoding: "utf-8",
          text: "# Restart chapter\nPersist this draft"
        }
      });
      const manuscript = await first.inject({
        method: "POST",
        url: `/api/projects/${projectId}/manuscript`,
        payload: { sourceDocumentId: source.json().document.id }
      });
      unitId = manuscript.json().units[0].unit.id as string;
      await first.inject({
        method: "PUT",
        url: `/api/projects/${projectId}/manuscript/units/${unitId}/draft`,
        payload: { prose: "Persisted after restart", expectedRevision: 1 }
      });
    } finally {
      await first.close();
    }

    const second = await buildApp({ databasePath });
    try {
      const reopened = await second.inject({ method: "GET", url: `/api/projects/${projectId}/manuscript` });
      expect(reopened.statusCode).toBe(200);
      expect(reopened.json().units[0]).toMatchObject({
        unit: { id: unitId },
        draft: { prose: "Persisted after restart", revision: 2 }
      });
      expect(reopened.json().units[0].sourceComparison.segment.text).toBe("# Restart chapter\nPersist this draft");
    } finally {
      await second.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
